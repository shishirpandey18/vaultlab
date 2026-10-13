-- VaultLab database schema (Day 9)
-- Run as the vaultlab user:  mariadb -u vaultlab -p vaultlab < db/schema.sql
-- WARNING: passwords are stored as plain text for now. Encryption comes later in the project.

CREATE TABLE IF NOT EXISTS items (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title      VARCHAR(100) NOT NULL,
  username   VARCHAR(255) NULL,
  password   VARCHAR(200) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NULL     ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);