-- RUN ONCE. Check information_schema first (columns/indexes below may already exist), and
-- confirm the charset/collation of schools and users with SHOW CREATE TABLE before applying so
-- the new foreign keys match. Do not switch these statements to IF NOT EXISTS: a partial earlier
-- run should be inspected, not silently skipped.
-- Migration: School booklists, collection days, listing flags
-- Date: 2026-11-24
-- ADR: adr-016 (school-cluster pilot)
-- Description:
--   1. school_booklists and school_booklist_items (school x grade x year x title).
--   2. collection_days (school handover days).
--   3. book_listings.written_in and book_listings.school_id.
--      (book_listings.condition already exists; "Worn" is added in the API enum only.)
--   4. wishlist_items.booklist_item_id (links an auto-built wishlist item to its booklist item).
--   5. swap_requests.collection_day_id (a swap is recorded as a handover at a collection day).
--
-- Charset/collation are left to the database default so the foreign keys to schools(id) and
-- users(id) match the drizzle-created tables.
-- Apply once, after 006. Run manually against the target database (no automatic runner).

CREATE TABLE IF NOT EXISTS school_booklists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  school_id VARCHAR(36) NOT NULL,
  grade VARCHAR(50) NOT NULL,
  year INT NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'school-issued',
  created_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_booklists_school_grade_year_source (school_id, grade, year, source),
  INDEX idx_school_booklists_school_grade_year (school_id, grade, year),
  CONSTRAINT fk_school_booklists_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  CONSTRAINT fk_school_booklists_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_booklist_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booklist_id INT NOT NULL,
  title VARCHAR(500) NOT NULL,
  subject VARCHAR(100) NULL,
  publisher VARCHAR(255) NULL,
  isbn VARCHAR(20) NULL,
  kicd_approved BOOLEAN NOT NULL DEFAULT FALSE,
  reusable BOOLEAN NOT NULL DEFAULT TRUE,
  list_price_kes DECIMAL(10, 2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_school_booklist_items_booklist (booklist_id),
  CONSTRAINT fk_school_booklist_items_booklist FOREIGN KEY (booklist_id) REFERENCES school_booklists(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS collection_days (
  id INT AUTO_INCREMENT PRIMARY KEY,
  school_id VARCHAR(36) NOT NULL,
  date DATE NOT NULL,
  start_time VARCHAR(5) NOT NULL,
  end_time VARCHAR(5) NOT NULL,
  venue_note TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  created_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_collection_days_school_date (school_id, date),
  INDEX idx_collection_days_status (status),
  CONSTRAINT fk_collection_days_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  CONSTRAINT fk_collection_days_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE book_listings
  ADD COLUMN written_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN school_id VARCHAR(36) NULL DEFAULT NULL,
  ADD INDEX idx_book_listings_school (school_id),
  ADD CONSTRAINT fk_book_listings_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL;

ALTER TABLE wishlist_items
  ADD COLUMN booklist_item_id INT NULL DEFAULT NULL,
  ADD UNIQUE KEY uq_wishlist_child_booklist_item (child_id, booklist_item_id);

ALTER TABLE swap_requests
  ADD COLUMN collection_day_id INT NULL DEFAULT NULL;

-- Rollback (manual):
--   ALTER TABLE swap_requests DROP COLUMN collection_day_id;
--   ALTER TABLE wishlist_items DROP INDEX uq_wishlist_child_booklist_item, DROP COLUMN booklist_item_id;
--   ALTER TABLE book_listings DROP FOREIGN KEY fk_book_listings_school, DROP COLUMN school_id, DROP COLUMN written_in;
--   DROP TABLE collection_days; DROP TABLE school_booklist_items; DROP TABLE school_booklists;
