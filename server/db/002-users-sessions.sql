-- Day 10: user accounts and login sessions
-- Run as the vaultlab user:  mariadb -u vaultlab -p vaultlab < db/002-users-sessions.sql

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,           -- scrypt$N$r$p$salt$hash, never the password
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64)     NOT NULL,              -- SHA-256 of the cookie's token, never the token
  user_id    INT UNSIGNED NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME     NOT NULL,
  PRIMARY KEY (token_hash),
  KEY sessions_user (user_id),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
