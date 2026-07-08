-- P1/P2 Progressive Trust Reveal & Feature Expansion Migration
-- Adds: judgment_round, season fields, HourglassFreeze table, StardustTicket table, Season table
-- Updates: User model with freeze/season/observer fields, OBSERVER role

-- Add OBSERVER to user_role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'OBSERVER';

-- Add new columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS freeze_remaining INTEGER NOT NULL DEFAULT 2;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stardust_fragments INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_season INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_badge BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS observer_fragments INTEGER NOT NULL DEFAULT 0;

-- Add new columns to connections table
ALTER TABLE connections ADD COLUMN IF NOT EXISTS judgment_round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS season INTEGER NOT NULL DEFAULT 1;

-- Index for season-based queries
CREATE INDEX IF NOT EXISTS idx_connections_season ON connections (season);

-- Create hourglass_freezes table
CREATE TABLE IF NOT EXISTS hourglass_freezes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    used_on_day INTEGER NOT NULL,
    season INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hourglass_freezes_user_season
    ON hourglass_freezes (user_id, season);
CREATE INDEX IF NOT EXISTS idx_hourglass_freezes_connection
    ON hourglass_freezes (connection_id);

-- Create stardust_tickets table (redesigned as growth record)
CREATE TABLE IF NOT EXISTS stardust_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    season INTEGER NOT NULL DEFAULT 1,
    outcome VARCHAR(16) NOT NULL,
    participated_days INTEGER NOT NULL DEFAULT 0,
    echo_count INTEGER NOT NULL DEFAULT 0,
    growth_tags TEXT NOT NULL DEFAULT '[]',
    highlight_answers TEXT NOT NULL DEFAULT '[]',
    soul_summary TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT stardust_tickets_user_connection_unique UNIQUE (user_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_stardust_tickets_user_season
    ON stardust_tickets (user_id, season);

-- Create seasons table
CREATE TABLE IF NOT EXISTS seasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_number INTEGER NOT NULL UNIQUE,
    theme VARCHAR(128) NOT NULL,
    starts_at TIMESTAMPTZ(6) NOT NULL,
    ends_at TIMESTAMPTZ(6) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seasons_active ON seasons (is_active);

-- Insert initial season
INSERT INTO seasons (season_number, theme, starts_at, ends_at, is_active)
VALUES (1, '初始赛季：命运的第一次碰撞', NOW(), NOW() + INTERVAL '30 days', TRUE)
ON CONFLICT (season_number) DO NOTHING;
