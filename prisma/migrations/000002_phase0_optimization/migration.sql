-- Phase 0 Optimization Migration
-- Adds: DailyEcho table, BOARDING room status, video privacy fields

-- Add new enum values
ALTER TYPE room_status ADD VALUE IF NOT EXISTS 'BOARDING' BEFORE 'RECRUITING';
ALTER TYPE reveal_level ADD VALUE IF NOT EXISTS 'SILHOUETTE';
ALTER TYPE reveal_level ADD VALUE IF NOT EXISTS 'FROSTED';
ALTER TYPE reveal_level ADD VALUE IF NOT EXISTS 'NEAR';
ALTER TYPE reveal_level ADD VALUE IF NOT EXISTS 'FULL';

-- Create reveal_level enum if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reveal_level') THEN
        CREATE TYPE reveal_level AS ENUM ('SILHOUETTE', 'FROSTED', 'NEAR', 'FULL');
    END IF;
END$$;

-- Add new columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS video_destroyed_at TIMESTAMPTZ(6);

-- Add new columns to instance_rooms table
ALTER TABLE instance_rooms ADD COLUMN IF NOT EXISTS min_users INTEGER NOT NULL DEFAULT 50;
ALTER TABLE instance_rooms ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ(6);
ALTER TABLE instance_rooms ADD COLUMN IF NOT EXISTS boarding_count INTEGER NOT NULL DEFAULT 0;

-- Create daily_echoes table
CREATE TABLE IF NOT EXISTS daily_echoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    day_number INTEGER NOT NULL,
    prompt_text TEXT NOT NULL,
    user_a_answer TEXT,
    user_b_answer TEXT,
    both_answered BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    answered_at TIMESTAMPTZ(6),

    CONSTRAINT daily_echoes_connection_day_unique UNIQUE (connection_id, day_number)
);

-- Indexes for daily_echoes
CREATE INDEX IF NOT EXISTS idx_daily_echoes_connection_answered
    ON daily_echoes (connection_id, both_answered);

-- Index for boarding room scheduled departure
CREATE INDEX IF NOT EXISTS idx_instance_rooms_status_scheduled
    ON instance_rooms (status, scheduled_at)
    WHERE scheduled_at IS NOT NULL;

-- Add CHECK constraint: boarding_count cannot exceed max_users
ALTER TABLE instance_rooms ADD CONSTRAINT chk_boarding_count
    CHECK (boarding_count <= max_users);

-- Add CHECK constraint: min_users must be positive and <= max_users
ALTER TABLE instance_rooms ADD CONSTRAINT chk_min_users
    CHECK (min_users > 0 AND min_users <= max_users);
