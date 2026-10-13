-- Sample items for development (fake passwords only)
-- Run as the vaultlab user:  mariadb -u vaultlab -p vaultlab < db/seed.sql
INSERT INTO items (title, username, password) VALUES
  ('GitHub', 'shishir', 'fake-Pass-111'),
  ('Email', 'shishir@example.com', 'fake-Pass-222'),
  ('Bank (demo)', NULL, 'fake-Pass-333');