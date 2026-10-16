-- Day 12, step 3 of 3: require the encrypted column and remove the plain-text one
-- Run:  sudo mariadb vaultlab < db/005-drop-plaintext.sql
-- ONLY after scripts/encrypt-existing.js said "0 left".
SELECT COUNT(*) AS not_encrypted_yet FROM items WHERE password_enc IS NULL;

ALTER TABLE items
  MODIFY password_enc TEXT NOT NULL,
  DROP COLUMN password;
