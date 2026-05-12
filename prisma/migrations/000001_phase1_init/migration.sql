CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "user_role" AS ENUM ('ACTIVE', 'WATCHER');
CREATE TYPE "room_status" AS ENUM ('RECRUITING', 'RUNNING', 'DESTROYED');
CREATE TYPE "connection_status" AS ENUM ('YOMI_MATCHING', 'SANDGLASS_24H', 'DEEP_LINK', 'JUDGMENT', 'DESTROYED');
CREATE TYPE "decision" AS ENUM ('NULL', 'DEFECT', 'COOPERATE');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "wechat_openid" VARCHAR(128) NOT NULL,
  "shadow_video_url" TEXT NOT NULL,
  "fire_points" INTEGER NOT NULL DEFAULT 3,
  "role" "user_role" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_fire_points_non_negative" CHECK ("fire_points" >= 0)
);

CREATE TABLE "instance_rooms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "max_users" INTEGER NOT NULL DEFAULT 100,
  "start_date" TIMESTAMPTZ(6) NOT NULL,
  "end_date" TIMESTAMPTZ(6) NOT NULL,
  "status" "room_status" NOT NULL DEFAULT 'RECRUITING',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "instance_rooms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instance_rooms_max_users_valid" CHECK ("max_users" > 0 AND "max_users" <= 100),
  CONSTRAINT "instance_rooms_exact_30_days" CHECK ("end_date" = "start_date" + INTERVAL '30 days')
);

CREATE TABLE "fate_cards" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "question_text" TEXT NOT NULL,
  "option_a" TEXT NOT NULL,
  "option_b" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fate_cards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fate_cards_question_not_blank" CHECK (length(trim("question_text")) > 0),
  CONSTRAINT "fate_cards_option_a_not_blank" CHECK (length(trim("option_a")) > 0),
  CONSTRAINT "fate_cards_option_b_not_blank" CHECK (length(trim("option_b")) > 0)
);

CREATE TABLE "connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_a_id" UUID NOT NULL,
  "user_b_id" UUID NOT NULL,
  "room_id" UUID NOT NULL,
  "status" "connection_status" NOT NULL DEFAULT 'YOMI_MATCHING',
  "connected_days" INTEGER NOT NULL DEFAULT 0,
  "user_a_decision" "decision" NOT NULL DEFAULT 'NULL',
  "user_b_decision" "decision" NOT NULL DEFAULT 'NULL',
  "sandglass_started_at" TIMESTAMPTZ(6),
  "deep_link_started_at" TIMESTAMPTZ(6),
  "judgment_started_at" TIMESTAMPTZ(6),
  "destroyed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "connections_distinct_users" CHECK ("user_a_id" <> "user_b_id"),
  CONSTRAINT "connections_connected_days_range" CHECK ("connected_days" >= 0 AND "connected_days" <= 30),
  CONSTRAINT "connections_user_a_fkey" FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "connections_user_b_fkey" FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "connections_room_fkey" FOREIGN KEY ("room_id") REFERENCES "instance_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "users_wechat_openid_key" ON "users"("wechat_openid");
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

CREATE INDEX "instance_rooms_status_start_date_idx" ON "instance_rooms"("status", "start_date");
CREATE INDEX "instance_rooms_end_date_idx" ON "instance_rooms"("end_date");

CREATE UNIQUE INDEX "fate_cards_question_text_key" ON "fate_cards"("question_text");

CREATE INDEX "connections_room_id_status_idx" ON "connections"("room_id", "status");
CREATE INDEX "connections_user_a_id_room_id_status_idx" ON "connections"("user_a_id", "room_id", "status");
CREATE INDEX "connections_user_b_id_room_id_status_idx" ON "connections"("user_b_id", "room_id", "status");
CREATE INDEX "connections_status_sandglass_started_at_idx" ON "connections"("status", "sandglass_started_at");
CREATE INDEX "connections_status_connected_days_idx" ON "connections"("status", "connected_days");
CREATE UNIQUE INDEX "connections_active_pair_room_unique" ON "connections"(
  LEAST("user_a_id", "user_b_id"),
  GREATEST("user_a_id", "user_b_id"),
  "room_id"
) WHERE "status" <> 'DESTROYED';
