-- Day 11: every item belongs to a user, and users have a role
-- Run as the vaultlab user:  mariadb -u vaultlab -p vaultlab < db/003-item-owners-roles.sql
-- BEFORE running: change the email below to YOUR account. Existing items will belong to it.
SET @owner = (SELECT id FROM users WHERE email = 'shishir@example.com');

-- Stop here if that account doesn't exist (the next statement would fail on NULL anyway)
SELECT IF(@owner IS NULL, 'NO SUCH USER: fix the email in this file', CONCAT('Existing items go to user ', @owner)) AS check_owner;

-- 1. The owner column, empty at first
ALTER TABLE items ADD COLUMN user_id INT UNSIGNED NULL AFTER id;

-- 2. Give every existing item to that account
UPDATE items SET user_id = @owner WHERE user_id IS NULL;

-- 3. From now on an owner is required, and must be a real user
ALTER TABLE items
  MODIFY user_id INT UNSIGNED NOT NULL,
  ADD KEY items_user (user_id),
  ADD CONSTRAINT items_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

-- 4. A role for every user: 'user' unless someone makes them 'admin'
ALTER TABLE users ADD COLUMN role ENUM('user', 'admin') NOT NULL DEFAULT 'user' AFTER password_hash;
