-- RUN ONCE. Check information_schema.columns first (the column may already exist).
-- Migration: OTP attempt counter
-- Date: 2026-11-24
-- ADR: adr-018 (auth hardening)
-- Description:
--   otp_codes.attempts counts wrong guesses against a code; the code is burned after 5.
--   Also indexes (email, created_at) for the per-email send limit.

ALTER TABLE otp_codes ADD COLUMN attempts INT NOT NULL DEFAULT 0;
CREATE INDEX idx_otp_email_created ON otp_codes (email, created_at);

-- Rollback:
--   DROP INDEX idx_otp_email_created ON otp_codes;
--   ALTER TABLE otp_codes DROP COLUMN attempts;
