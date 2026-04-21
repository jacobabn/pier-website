// Naive per-license hourly rate limiter backed by the rate_limits table.
// Caller gets { allowed, count, max } back; if allowed === false, respond 429.
// Atomic UPSERT-and-increment via ON CONFLICT so concurrent calls don't race.

const { query } = require('./db');

async function bump(licenseId, { max = 20 } = {}) {
  // Bucket by the clock hour so a surge in minute 55 gets a fresh budget at
  // minute 0 of the next hour. UTC intentionally — no DST edges.
  const hour = new Date();
  hour.setUTCMinutes(0, 0, 0);
  const bucket = hour.toISOString();
  const { rows } = await query(
    `INSERT INTO rate_limits (license_id, bucket_hour, count)
       VALUES ($1, $2, 1)
     ON CONFLICT (license_id, bucket_hour) DO UPDATE
       SET count = rate_limits.count + 1
     RETURNING count`,
    [licenseId, bucket],
  );
  const count = rows[0].count;
  return { allowed: count <= max, count, max };
}

module.exports = { bump };
