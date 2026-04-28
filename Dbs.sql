-- CERP — Community Emergency Reporting Platform
-- Database schema for the Kasoa community emergency system
-- Run once: psql -U postgres -d cerp -f src/schema.sql

-- Enable the pgcrypto extension so we can use gen_random_uuid() for primary keys
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS TABLE ──────────────────────────────────────────────────────────────
-- Stores all platform users: citizens who report incidents, responders who
-- attend scenes, and admins who manage the Kasoa command center
CREATE TABLE IF NOT EXISTS users (
  -- Unique identifier generated automatically for each user
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Full name of the user as entered during registration
  name          VARCHAR(120) NOT NULL,
  -- Email address used to log in — must be unique across the platform
  email         VARCHAR(255) UNIQUE NOT NULL,
  -- Bcrypt hash of the user's password — the plaintext is never stored
  password_hash TEXT NOT NULL,
  -- Role determines what the user can do on the platform
  -- citizen: can report incidents and receive alerts
  -- responder: can view and update incident status
  -- admin: full access including dispatch and alert broadcasting
  role          VARCHAR(20) NOT NULL DEFAULT 'citizen'
                  CHECK (role IN ('citizen', 'responder', 'admin')),
  -- The specific Kasoa community town the user is based in
  region        VARCHAR(100),
  -- Timestamp of when the user account was created
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── INCIDENTS TABLE ───────────────────────────────────────────────────────────
-- Stores every emergency incident reported by citizens in the Kasoa community
CREATE TABLE IF NOT EXISTS incidents (
  -- Unique identifier generated automatically for each incident
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Category of the emergency — one of the three types CERP handles
  type             VARCHAR(20) NOT NULL
                     CHECK (type IN ('flood', 'fire', 'accident')),
  -- Free-text description of what is happening at the scene
  description      TEXT NOT NULL,
  -- Street address or landmark where the incident occurred in Kasoa
  location_text    VARCHAR(255) NOT NULL,
  -- GPS latitude coordinate — allows the incident to be placed on the map
  latitude         NUMERIC(10, 7),
  -- GPS longitude coordinate — allows the incident to be placed on the map
  longitude        NUMERIC(10, 7),
  -- The specific Kasoa community town where the incident occurred
  region           VARCHAR(100) NOT NULL,
  -- How critical the incident is — set by the admin after review
  severity         VARCHAR(20) NOT NULL DEFAULT 'low'
                     CHECK (severity IN ('low', 'moderate', 'critical')),
  -- Current stage in the dispatch workflow
  status           VARCHAR(20) NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'dispatched', 'resolved')),
  -- Name of the Kasoa emergency agency assigned to respond
  assigned_agency  VARCHAR(120),
  -- Foreign key linking to the user who submitted the report
  reported_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Array of URLs pointing to photos or videos uploaded with the report
  media_urls       TEXT[] DEFAULT '{}',
  -- Timestamp of when the incident was first reported
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Timestamp of the most recent update to this incident record
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AUTO-UPDATE TRIGGER ───────────────────────────────────────────────────────
-- This function sets the updated_at field to the current time on every update
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Set updated_at to the current timestamp whenever a row is modified
  NEW.updated_at = NOW();
  -- Return the modified row so the update proceeds
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach the trigger to the incidents table so it fires before every UPDATE
CREATE TRIGGER incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── ALERTS TABLE ──────────────────────────────────────────────────────────────
-- Stores broadcast alerts sent by admins to Kasoa community members
CREATE TABLE IF NOT EXISTS alerts (
  -- Unique identifier generated automatically for each alert
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Short title displayed in the push notification or SMS header
  title          VARCHAR(255) NOT NULL,
  -- Full message body of the alert
  message        TEXT NOT NULL,
  -- The Kasoa community town targeted by this alert
  -- "All Kasoa Towns" means the alert goes to the entire community
  target_region  VARCHAR(100) NOT NULL DEFAULT 'All Kasoa Towns',
  -- Optional geo-fence radius in kilometres around the target area
  radius_km      INTEGER,
  -- Array of delivery channels used: sms, push, web
  channels       TEXT[] NOT NULL DEFAULT '{web}',
  -- Foreign key linking to the admin user who broadcast this alert
  issued_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Timestamp of when the alert was broadcast
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RESPONSE LOGS TABLE ───────────────────────────────────────────────────────
-- Tracks every action taken on an incident for full audit trail
CREATE TABLE IF NOT EXISTS response_logs (
  -- Unique identifier generated automatically for each log entry
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The incident this log entry relates to
  incident_id  UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  -- The responder or admin who performed this action
  responder_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Description of the action taken e.g. "Status changed to dispatched"
  action       TEXT NOT NULL,
  -- Timestamp of when this action occurred
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────────────────────
-- Index on incident status to speed up filtering by new/dispatched/resolved
CREATE INDEX IF NOT EXISTS idx_incidents_status   ON incidents(status);
-- Index on incident type to speed up filtering by flood/fire/accident
CREATE INDEX IF NOT EXISTS idx_incidents_type     ON incidents(type);
-- Index on Kasoa town to speed up filtering incidents by community area
CREATE INDEX IF NOT EXISTS idx_incidents_region   ON incidents(region);
-- Index on created_at descending so the most recent incidents load first
CREATE INDEX IF NOT EXISTS idx_incidents_created  ON incidents(created_at DESC);
-- Index on alert target region to speed up fetching alerts for a specific town
CREATE INDEX IF NOT EXISTS idx_alerts_region      ON alerts(target_region);
-- Index to quickly fetch all response logs for a given incident
CREATE INDEX IF NOT EXISTS idx_response_logs_inc  ON response_logs(incident_id);
