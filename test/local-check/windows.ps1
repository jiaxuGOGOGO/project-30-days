# Compatible with Windows PowerShell 5.1 and PowerShell 7. No global policy changes.
[CmdletBinding()]
param([ValidatePattern('^p30check[0-9a-f]{12}$')][string]$CleanupRun)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$utf8 = New-Object System.Text.UTF8Encoding($false)
$project = if ($CleanupRun) { $CleanupRun } else { 'p30check' + [Guid]::NewGuid().ToString('N').Substring(0,12) }
$runDir = Join-Path $root ('.local-check/' + $project)
$composeFile = Join-Path $runDir 'compose.json'
$emptyEnv = Join-Path $runDir 'empty.env'
$outputDir = Join-Path $runDir 'output'
$reportFile = Join-Path $outputDir 'REPORT.txt'
$engineLog = Join-Path $runDir 'engine-local-only.log'
$composeArgs = @('compose','--env-file',$emptyEnv,'--project-directory',$root,'-p',$project,'-f',$composeFile)
$exitCode = 3
$cleanup = 'NOT_STARTED'
$stage = 'preflight'
$commit = 'unknown'
$archiveHash = 'unknown'
$created = $false
$contextName = ''
$dockerVersion = 'unknown'
$resources = 'unknown'
$started = [DateTime]::UtcNow.ToString('o')
function Write-Utf8([string]$file, [string]$text) { [IO.File]::WriteAllText($file, $text, $utf8) }
function Docker-Run([string[]]$Arguments) {
    $previousPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 can represent native stderr as ErrorRecord even on success.
        # Capture it locally and use the actual native exit code, not stderr presence.
        $ErrorActionPreference = 'Continue'
        & docker --context $contextName @Arguments 2>&1 | ForEach-Object {
            $line = $_.ToString()
            [IO.File]::AppendAllText($engineLog, $line + [Environment]::NewLine, $utf8)
            if ($line.StartsWith('[local-check]')) { Write-Host $line }
        }
        $nativeExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    return $nativeExit
}
function Check-LocalDocker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install and start Docker Desktop first.' }
    if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT) { throw 'Unset DOCKER_HOST/DOCKER_CONTEXT for this session; only the selected local Desktop context is allowed.' }
    $script:contextName = ((& docker context show 2>$null) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $contextName) { throw 'Docker context unavailable.' }
    $endpoint = ((& docker context inspect $contextName --format '{{.Endpoints.docker.Host}}' 2>$null) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $endpoint -notmatch '^(npipe://|unix://)') { throw 'Remote Docker endpoints are refused.' }
    $os = ((& docker --context $contextName info --format '{{.OSType}}' 2>$null) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $os -ne 'linux') { throw 'Start Docker Desktop using Linux containers / WSL 2.' }
    $composeVersion = ((& docker --context $contextName compose version --short 2>$null) | Out-String).Trim().TrimStart('v')
    if ($LASTEXITCODE -ne 0 -or $composeVersion -notmatch '^(\d+)\.(\d+)\.') { throw 'Docker Compose v2 is required.' }
    if ([int]$Matches[1] -lt 2 -or ([int]$Matches[1] -eq 2 -and [int]$Matches[2] -lt 20)) { throw 'Docker Compose 2.20 or newer is required.' }
    $script:dockerVersion = ((& docker --context $contextName version --format '{{.Server.Version}}' 2>$null) | Out-String).Trim()
    $script:resources = ((& docker --context $contextName info --format '{{.NCPU}} CPUs / {{.MemTotal}} bytes / {{.Architecture}}' 2>$null) | Out-String).Trim()
}
if ($CleanupRun) {
    # Only a specifically named run owned by this launcher can be cleaned up.
    $markerFile = Join-Path $runDir 'owner.json'
    if (-not (Test-Path $markerFile) -or -not (Test-Path $composeFile)) { throw 'No owned run found; no cleanup performed.' }
    $marker = Get-Content $markerFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($marker.owner -ne 'project30-local-check-v1' -or $marker.project -ne $project) { throw 'Ownership mismatch; no cleanup performed.' }
    Check-LocalDocker
    $code = Docker-Run ($composeArgs + @('down','--volumes','--remove-orphans','--timeout','15'))
    if ($code -ne 0) { throw 'Cleanup failed. Keep the report and retry after Docker starts.' }
    Write-Host ('Cleaned only run ' + $project + '. Reports were kept.')
    exit 0
}
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
Write-Utf8 $reportFile "PROJECT30 LOCAL CHECK`nOverall: INCOMPLETE`nRun: $project`nThe launcher has started; no checks passed yet.`n"
try {
    Set-Location $root
    $stage = 'git-preflight'
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Install Git for Windows and open a new PowerShell window.' }
    $commit = ((& git rev-parse HEAD 2>$null) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Run from a Git clone, not a downloaded ZIP.' }
    $dirty = ((& git status --porcelain --untracked-files=normal) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Working tree contains changes. Use a clean clone; nothing was reset or removed.' }
    # Never archive personal dotenv files, even if someone accidentally tracked one.
    $tracked = @(& git ls-files)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect tracked files.' }
    foreach ($file in $tracked) {
        if ($file -match '(^|/)\.env($|\.)' -and $file -notmatch '(^|/)\.env\.example$') { throw 'Tracked dotenv file refused.' }
    }
    $stage = 'docker-preflight'
    Check-LocalDocker
    $stage = 'archive'
    $archive = Join-Path $runDir 'source.tar'
    & git archive '--format=tar' '-o' $archive HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot archive committed source.' }
    $archiveHash = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Utf8 $emptyEnv ''
    Write-Utf8 (Join-Path $runDir 'owner.json') ((@{ owner='project30-local-check-v1'; project=$project; commit=$commit }) | ConvertTo-Json)
    $password = [Guid]::NewGuid().ToString('N')
    $adminUrl = 'postgresql://localcheck:' + $password + '@127.0.0.1:5432/postgres'
    # No host ports, host networking, external volumes, Docker socket, .env or home mounts.
    # Sharing the DB network namespace makes loopback-only test safety guards work unchanged.
    $compose = @{
        services = @{
            database = @{
                image='postgres:16-bookworm@sha256:efedf3595f1d6f415c08568ba171029bf54052e754cc9f030e3f2412b21f3d67'
                environment=@{ POSTGRES_USER='localcheck'; POSTGRES_PASSWORD=$password; POSTGRES_DB='postgres' }
                command=@('postgres','-c','listen_addresses=127.0.0.1','-c','max_connections=40','-c','shared_buffers=32MB')
                volumes=@('pgdata:/var/lib/postgresql/data')
                mem_limit='512m'
                healthcheck=@{ test=@('CMD','pg_isready','-h','127.0.0.1','-U','localcheck','-d','postgres'); interval='2s'; timeout='3s'; retries=45 }
            }
            cache = @{
                image='redis:7.4-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499'
                network_mode='service:database'
                command=@('redis-server','--bind','127.0.0.1','--save','','--appendonly','no','--maxmemory','128mb')
                mem_limit='192m'
                healthcheck=@{ test=@('CMD','redis-cli','-h','127.0.0.1','ping'); interval='2s'; timeout='3s'; retries=45 }
            }
            checker = @{
                image='node:22.23.2-bookworm@sha256:dd5847a04b0deee391fa145f1f4c6d214196668b6bcc7988ebed67249f226844'
                network_mode='service:database'
                init=$true
                mem_limit='3g'
                working_dir='/work'
                environment=@{ LOCAL_CHECK_ADMIN_URL=$adminUrl; LOCAL_CHECK_SOURCE_COMMIT=$commit; LOCAL_CHECK_ARCHIVE_SHA256=$archiveHash }
                volumes=@(
                    @{ type='bind'; source=$archive.Replace('$','$$'); target='/input/source.tar'; read_only=$true },
                    @{ type='bind'; source=$outputDir.Replace('$','$$'); target='/output' }
                )
                command=@('bash','-lc','tar -xf /input/source.tar -C /work && node test/local-check/run.cjs')
            }
        }
        volumes=@{ pgdata=@{} }
    }
    Write-Utf8 $composeFile ($compose | ConvertTo-Json -Depth 12)
    $stage = 'compose-validation'
    if ((Docker-Run ($composeArgs + @('config','--quiet'))) -ne 0) { throw 'Compose configuration was rejected.' }
    $created = $true
    $stage = 'image-pull'
    Write-Host 'Pulling pinned official images. First run needs internet and may take several minutes.'
    if ((Docker-Run ($composeArgs + @('pull'))) -ne 0) { throw 'Image download failed; check Docker network/proxy configuration.' }
    $stage = 'service-readiness'
    Write-Host 'Starting isolated disposable PostgreSQL and Redis (no published ports).'
    if ((Docker-Run ($composeArgs + @('up','-d','--wait','--wait-timeout','120','database','cache'))) -ne 0) { throw 'Disposable services did not become healthy.' }
    $stage = 'checks'
    Write-Host 'Running tests. Keep this window open; stage results appear below.'
    $code = Docker-Run ($composeArgs + @('run','--rm','--no-deps','-T','checker'))
    $jsonFile = Join-Path $outputDir 'report.json'
    if (-not (Test-Path $jsonFile)) { throw 'Checker stopped before producing a report.' }
    $result = Get-Content $jsonFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $codes = @{ PASS=0; KNOWN_ISSUES=2; REGRESSION=1; ENVIRONMENT_BLOCKED=3; INCOMPLETE=4 }
    if ($result.commit -ne $commit -or -not $codes.ContainsKey($result.overall) -or $code -ne $codes[$result.overall]) { throw 'Report or exit status mismatch; no pass can be claimed.' }
    $exitCode = $code
    $stage = 'finished'
} catch {
    # Engine logs may contain paths/proxy configuration: local-only, never copied into shareable report.
    Write-Host ('Stopped at ' + $stage + ': ' + $_.Exception.Message)
    [IO.File]::AppendAllText($reportFile, "`nLauncher: ENVIRONMENT_BLOCKED or interrupted at $stage. No pass claimed.`nHint: check Git clean state, Docker Desktop Linux/WSL2, local context, network and free disk/memory.`n", $utf8)
    $exitCode = 3
} finally {
    if ($created) {
        $cleanup = 'FAILED'
        try {
            if ((Docker-Run ($composeArgs + @('down','--volumes','--remove-orphans','--timeout','15'))) -eq 0) { $cleanup = 'PASS' }
        } catch { $cleanup = 'FAILED' }
        if ($cleanup -ne 'PASS') { $exitCode = 4 }
    } else { $cleanup = 'NOT_NEEDED' }
    $safeResources = if ($resources -match '^\d+ CPUs / \d+ bytes / [a-zA-Z0-9_]+$') { $resources } else { 'unavailable' }
    $safeVersion = if ($dockerVersion -match '^[0-9][0-9A-Za-z.\-]+$') { $dockerVersion } else { 'unavailable' }
    $finalStatus = @{ 0='CHECKS_PASS'; 1='REGRESSION'; 2='KNOWN_ISSUES'; 3='ENVIRONMENT_BLOCKED'; 4='INCOMPLETE' }[$exitCode]
    [IO.File]::AppendAllText($reportFile, "`n--- Launcher ---`nFinal result: $finalStatus`nSource commit: $commit`nSource archive SHA256: $archiveHash`nStarted UTC: $started`nPowerShell: $($PSVersionTable.PSVersion)`nDocker server: $safeVersion`nDocker resources: $safeResources`nRun: $project`nLauncher stage: $stage`nCompose cleanup: $cleanup`nLauncher exit: $exitCode`nNo real users, host .env, or existing Docker volumes used.`nDocker/Windows first-run feedback is required; no native Windows acceptance is claimed by the author.`n", $utf8)
    $lastReport = Join-Path $root '.local-check/last-report.txt'
    Copy-Item $reportFile $lastReport -Force
    Write-Host ''
    Write-Host ('Report: ' + $lastReport)
    Write-Host 'Paste only last-report.txt back into chat (review it first). Do not paste engine-local-only.log or compose.json.'
    if ($exitCode -eq 2) { Write-Host 'KNOWN_ISSUES is expected for the current business defects; paste the report, do not reinstall.' }
    if ($cleanup -eq 'FAILED') { Write-Host ('Cleanup retry: powershell -NoProfile -ExecutionPolicy Bypass -File .\test\local-check\windows.ps1 -CleanupRun ' + $project) }
}
exit $exitCode
