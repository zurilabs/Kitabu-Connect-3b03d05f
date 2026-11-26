-- RUN ONCE. Check information_schema first (the table may already exist), and confirm the
-- charset/collation of users, book_listings and collection_days with SHOW CREATE TABLE before
-- applying so the new foreign keys match.
-- Migration: Listing reservations (Reserve button)
-- Date: 2026-11-24
-- ADR: adr-017 (pilot buyer-to-seller contact)
-- Description:
--   listing_reservations: a buyer reserves one sell listing for a school collection day.
--   book_listings.listing_status gains the value 'reserved' (it is a varchar, no DDL needed).
--   status values: reserved | cancelled | completed.

CREATE TABLE listing_reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  listing_id INT NOT NULL,
  buyer_id VARCHAR(36) NOT NULL,
  seller_id VARCHAR(36) NOT NULL,
  collection_day_id INT NULL,
  status ENUM('reserved','cancelled','completed') NOT NULL DEFAULT 'reserved',
  buyer_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  seller_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_by VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_listing_reservations_listing_status (listing_id, status),
  INDEX idx_listing_reservations_buyer_status (buyer_id, status),
  INDEX idx_listing_reservations_seller_status (seller_id, status),
  CONSTRAINT fk_listing_reservations_listing FOREIGN KEY (listing_id) REFERENCES book_listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_listing_reservations_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_listing_reservations_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_listing_reservations_day FOREIGN KEY (collection_day_id) REFERENCES collection_days(id) ON DELETE SET NULL,
  CONSTRAINT fk_listing_reservations_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Rollback (manual):
--   DROP TABLE listing_reservations;
--   UPDATE book_listings SET listing_status = 'active' WHERE listing_status = 'reserved';
