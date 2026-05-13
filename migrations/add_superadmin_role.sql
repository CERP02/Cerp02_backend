-- Migration to add superadmin role
-- Run: psql -U postgres -d cerp -f migrations/add_superadmin_role.sql

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('citizen', 'responder', 'admin', 'superadmin'));
