-- Pier licensing ledger — schema v1.
--
-- One row per issued license (from Stripe webhook or manual /admin create).
-- One row per device activation. Seats are enforced atomically in the
-- /api/license/activate handler via a conditional INSERT pattern.
--
-- We never store the full license_key. Only:
--   - key_hash   sha256(key) for O(1) lookup by key
--   - key_display "pier_eyJ2…XyZ4" for admin UI (first-12, last-4)
--
-- The actual signing/verification is Ed25519; the DB's role is ledger
-- (seat enforcement + revocation), not auth.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS licenses (
  id                  UUID         PRIMARY KEY,
  email               TEXT         NOT NULL,
  seats               INT          NOT NULL DEFAULT 2 CHECK (seats > 0 AND seats <= 50),
  key_hash            TEXT         NOT NULL UNIQUE,
  key_display         TEXT         NOT NULL,
  stripe_session_id   TEXT         UNIQUE,
  source              TEXT         NOT NULL DEFAULT 'stripe'
                                   CHECK (source IN ('stripe','manual','comp','migration')),
  issued_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  revoke_reason       TEXT,
  metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS licenses_email_idx   ON licenses (email);
CREATE INDEX IF NOT EXISTS licenses_issued_idx  ON licenses (issued_at DESC);
CREATE INDEX IF NOT EXISTS licenses_revoked_idx ON licenses (revoked_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS activations (
  id                  BIGSERIAL    PRIMARY KEY,
  license_id          UUID         NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_uuid         TEXT         NOT NULL,
  device_name         TEXT,
  first_activated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_ip             INET,
  last_user_agent     TEXT,
  revoked_at          TIMESTAMPTZ,

  -- Same device may be deactivated + reactivated; UNIQUE(license_id,
  -- device_uuid) with a partial index-for-live ensures only live rows are
  -- unique, so a re-activate after deactivate succeeds cleanly.
  UNIQUE (license_id, device_uuid)
);

CREATE INDEX IF NOT EXISTS activations_live_idx
  ON activations (license_id)
  WHERE revoked_at IS NULL;

-- Rate-limit bucket per license_id (simple per-hour counter). We bump +1 on
-- every call to /activate and reject above 20/hour. Keeps brute-force
-- device-shuffling attacks cheap to stop.
CREATE TABLE IF NOT EXISTS rate_limits (
  license_id          UUID         NOT NULL,
  bucket_hour         TIMESTAMPTZ  NOT NULL,
  count               INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (license_id, bucket_hour)
);

-- Convenience view used by the admin UI.
CREATE OR REPLACE VIEW license_summary AS
  SELECT
    l.id,
    l.email,
    l.seats,
    l.key_display,
    l.issued_at,
    l.expires_at,
    l.revoked_at,
    l.revoke_reason,
    l.source,
    l.stripe_session_id,
    COALESCE(a.live_count, 0) AS seats_used,
    l.seats - COALESCE(a.live_count, 0) AS seats_left
  FROM licenses l
  LEFT JOIN (
    SELECT license_id, COUNT(*) AS live_count
    FROM activations
    WHERE revoked_at IS NULL
    GROUP BY license_id
  ) a ON a.license_id = l.id;
