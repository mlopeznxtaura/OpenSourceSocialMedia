-- Colossus Social Kernel – Initial Schema
-- Migration: 001_init

BEGIN;

-- ── Identity ─────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colossus_id  TEXT UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE external_identities (
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider             TEXT NOT NULL,
    provider_user_id     TEXT NOT NULL,
    oauth_token_encrypted BYTEA,
    refresh_token_encrypted BYTEA,
    token_expires_at     TIMESTAMPTZ,
    raw_profile          JSONB,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, provider)
);

CREATE INDEX idx_external_identities_provider ON external_identities(provider, provider_user_id);

-- ── Relationships ────────────────────────────────────────────────────────────
CREATE TABLE follows (
    follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, followee_id)
);

CREATE INDEX idx_follows_followee ON follows(followee_id);

CREATE TABLE blocks (
    blocker_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id)
);

-- ── Content Metadata ─────────────────────────────────────────────────────────
CREATE TABLE content_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_url     TEXT NOT NULL,    -- ipfs://, s3://, ar://
    content_hash    TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    mini_kernel_id  TEXT NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_items_owner    ON content_items(owner_id);
CREATE INDEX idx_content_items_kernel   ON content_items(mini_kernel_id);
CREATE INDEX idx_content_items_created  ON content_items(created_at DESC);

-- ── Mini-Kernel Registry ─────────────────────────────────────────────────────
CREATE TABLE mini_kernel_registry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kernel_id       TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    version         TEXT NOT NULL,
    manifest        JSONB NOT NULL,
    endpoint_url    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending|active|degraded|offline
    approved_at     TIMESTAMPTZ,
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat  TIMESTAMPTZ
);

CREATE INDEX idx_mk_registry_status ON mini_kernel_registry(status);

-- ── Feed Interactions ────────────────────────────────────────────────────────
CREATE TABLE interactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_id      UUID NOT NULL,                   -- FK to content in mini-kernel
    source_kernel   TEXT NOT NULL,
    interaction_type TEXT NOT NULL,                  -- 'like','comment','share','bookmark'
    payload         JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interactions_content ON interactions(content_id, source_kernel);
CREATE INDEX idx_interactions_user    ON interactions(user_id);

-- ── Sessions / Refresh Tokens ────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked     BOOLEAN NOT NULL DEFAULT FALSE
);

-- ── Custom Feed Algorithms ───────────────────────────────────────────────────
CREATE TABLE user_algorithms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    runtime     TEXT NOT NULL DEFAULT 'js',  -- 'js' | 'wasm'
    code        TEXT NOT NULL,               -- sandboxed fn body
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
