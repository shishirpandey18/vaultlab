-- Day 12, step 1 of 3: a column for the encrypted passwords, empty at first
-- Run:  sudo mariadb vaultlab < db/004-encrypt-passwords.sql
-- Step 2 is the Node script scripts/encrypt-existing.js (SQL can't do AES-GCM with our key).
-- Step 3 is db/005-drop-plaintext.sql, ONLY after step 2 reported every item encrypted.
ALTER TABLE items ADD COLUMN password_enc TEXT NULL AFTER password;
