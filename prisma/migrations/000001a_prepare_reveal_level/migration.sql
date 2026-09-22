-- Compatibility prerequisite for the original 000002 migration.
-- Keep all previously shipped migration checksums unchanged.
-- Fresh databases run this before 000002; existing databases safely no-op.
DO $$
BEGIN
    IF to_regtype('public.reveal_level') IS NULL THEN
        CREATE TYPE public.reveal_level AS ENUM ('SILHOUETTE', 'FROSTED', 'NEAR', 'FULL');
    END IF;
END
$$;
