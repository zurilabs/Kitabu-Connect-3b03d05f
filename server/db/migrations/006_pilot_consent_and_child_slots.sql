-- Migration: Pilot consent and child slots
-- Date: 2026-11-24
-- ADR: adr-016 (school-cluster pilot)
-- Description:
--   1. Parental consent columns on users (verifiable and withdrawable).
--   2. Child data minimisation: children.name is no longer collected. It is made
--      explicitly nullable (it already was in the 0000 snapshot; this makes the intent
--      permanent and safe on databases built from older SQL). NO data is dropped.
--   3. children.curriculum so a child slot is grade + school + curriculum.
--
-- Apply once. Run manually against the target database (no automatic runner).

ALTER TABLE users
  ADD COLUMN consent_given_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN consent_version VARCHAR(20) NULL DEFAULT NULL,
  ADD COLUMN consent_withdrawn_at TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE children
  MODIFY COLUMN name VARCHAR(255) NULL,
  ADD COLUMN curriculum VARCHAR(50) NULL DEFAULT NULL;

-- Rollback (manual):
--   ALTER TABLE children DROP COLUMN curriculum;
--   ALTER TABLE users DROP COLUMN consent_withdrawn_at, DROP COLUMN consent_version, DROP COLUMN consent_given_at;
