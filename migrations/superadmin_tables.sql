-- ── AUDIT LOGS TABLE ──────────────────────────────────────────────────────────
-- Tracks critical administrative actions for security and compliance
CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The admin or superadmin who performed the action
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Human-readable description of the action (e.g., "Promoted user@example.com to admin")
  action        TEXT NOT NULL,
  -- Optional ID of the resource affected (e.g., the ID of the promoted user)
  target_id     UUID,
  -- Type of resource affected (e.g., "user", "incident", "settings")
  target_type   VARCHAR(50),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── SETTINGS TABLE ────────────────────────────────────────────────────────────
-- Stores platform-level configuration settings
CREATE TABLE IF NOT EXISTS settings (
  key           VARCHAR(100) PRIMARY KEY,
  value         TEXT NOT NULL,
  description   TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial settings
INSERT INTO settings (key, value, description) VALUES
('app_name', 'CERP - Kasoa', 'The display name of the platform'),
('contact_email', 'support@cerp-kasoa.gov.gh', 'Official support email address'),
('sms_notifications_enabled', 'true', 'Toggle for system-wide SMS alerts')
ON CONFLICT (key) DO NOTHING;
