-- Migration 014: Add failed_login_attempts table for account lockout protection
-- Purpose: Track failed login attempts to prevent brute-force attacks
-- Security: Enables account lockout after N failed attempts

CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  reason VARCHAR(50),
  attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_failed_login_username ON failed_login_attempts(username);
CREATE INDEX IF NOT EXISTS idx_failed_login_ip ON failed_login_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_failed_login_attempted_at ON failed_login_attempts(attempted_at);

-- Composite index for lockout check query (username + timestamp)
CREATE INDEX IF NOT EXISTS idx_failed_login_lockout_check ON failed_login_attempts(username, attempted_at DESC);

-- Add comment for documentation
COMMENT ON TABLE failed_login_attempts IS 'Tracks failed admin login attempts for brute-force protection';
COMMENT ON COLUMN failed_login_attempts.username IS 'Username attempted (even if non-existent)';
COMMENT ON COLUMN failed_login_attempts.ip_address IS 'IP address of the failed login attempt';
COMMENT ON COLUMN failed_login_attempts.reason IS 'Reason for failure (USER_NOT_FOUND, WRONG_PASSWORD, etc.)';
COMMENT ON COLUMN failed_login_attempts.attempted_at IS 'Timestamp of the failed attempt';
