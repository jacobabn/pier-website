// POST /api/license/activate
// Body: { license_key, device_uuid, device_name? }
//
// Flow:
//   1. Verify Ed25519 signature offline — rejects forged keys instantly.
//      (DB breach can't mint new keys because private key isn't in DB.)
//   2. Look up license row by sha256(license_key).
//   3. If license missing or revoked, reject.
//   4. If this device already activated (live row) → bump last_seen_at.
//   5. Else count live activations; if < seats → INSERT new row.
//      Else reject 403 with "SEAT_LIMIT".
//   6. Return { ok, activation_id, seats_used, seats, email, ... }.
//
// All state mutations happen inside a single SERIALIZABLE transaction so
// concurrent activates on the same license can't both slip past the seat
// count (the loser retries).

const { getPool } = require('../_lib/db');
const { parseAndVerify, keyHash } = require('../_lib/license');
const { bump } = require('../_lib/ratelimit');

module.exports.config = { api: { bodyParser: false } };

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }

  let body;
  try { body = await readJsonBody(req); }
  catch { return res.status(400).json({ error: 'invalid json' }); }

  const licenseKey = typeof body.license_key === 'string' ? body.license_key.trim() : '';
  const deviceUuid = typeof body.device_uuid === 'string' ? body.device_uuid.trim() : '';
  const deviceName = typeof body.device_name === 'string' ? body.device_name.trim().slice(0, 120) : null;
  if (!licenseKey || !deviceUuid) return res.status(400).json({ error: 'license_key + device_uuid required' });

  // 1. Signature check — cheap, no DB call if it fails.
  let payload;
  try { payload = parseAndVerify(licenseKey); }
  catch (e) { return res.status(400).json({ error: { code: e.code, message: e.message } }); }

  const hash = keyHash(licenseKey);
  const userAgent = req.headers['user-agent'] || null;
  const ip = clientIp(req);

  // 2. Rate-limit per license (20/hr) — fail-open if the check itself errors.
  try {
    const rl = await bump(payload.lid, { max: 20 });
    if (!rl.allowed) {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: `Too many activation attempts this hour (${rl.count}/${rl.max}). Try again in an hour.` } });
    }
  } catch (e) {
    // Don't block legit users over a rate-limiter bug.
    console.warn('[activate] rate-limit check failed:', e.message);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    // 3. Look up license. Must match key_hash AND lid (both come from the same
    // signed payload so this is belt-and-braces).
    const { rows: licRows } = await client.query(
      `SELECT id, email, seats, revoked_at, expires_at
         FROM licenses
        WHERE id = $1 AND key_hash = $2`,
      [payload.lid, hash],
    );
    if (licRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'UNKNOWN_LICENSE', message: 'This license was not found. It may have been issued in a different environment, or the Pier version is too old.' } });
    }
    const lic = licRows[0];
    if (lic.revoked_at) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: { code: 'REVOKED', message: 'This license has been revoked. Contact support if you think this is an error.' } });
    }
    if (lic.expires_at && new Date(lic.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: { code: 'EXPIRED', message: 'This license has expired.' } });
    }

    // 4. Is this device already a live activation? If yes, just update last_seen.
    const { rows: existing } = await client.query(
      `SELECT id, first_activated_at FROM activations
        WHERE license_id = $1 AND device_uuid = $2 AND revoked_at IS NULL`,
      [lic.id, deviceUuid],
    );
    if (existing.length > 0) {
      await client.query(
        `UPDATE activations
            SET last_seen_at = NOW(), last_ip = $3::inet, last_user_agent = $4, device_name = COALESCE($5, device_name)
          WHERE id = $1
        RETURNING id, first_activated_at`,
        [existing[0].id, null, ip, userAgent, deviceName],
      );
    } else {
      // 5. Count live activations. If < seats, insert. Else 403.
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*)::int AS live FROM activations
          WHERE license_id = $1 AND revoked_at IS NULL`,
        [lic.id],
      );
      const live = countRows[0].live;
      if (live >= lic.seats) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: {
            code: 'SEAT_LIMIT',
            message: `This license is already active on ${live} Mac(s) — the maximum for this license is ${lic.seats}. Deactivate one from Pier Settings on another Mac, or contact support.`,
            seats: lic.seats,
            seats_used: live,
          },
        });
      }
      // There may be a previously-revoked row for this same device — reactivate it.
      const { rows: revived } = await client.query(
        `UPDATE activations
            SET revoked_at = NULL, last_seen_at = NOW(), last_ip = $3::inet, last_user_agent = $4, device_name = COALESCE($5, device_name)
          WHERE license_id = $1 AND device_uuid = $2
        RETURNING id`,
        [lic.id, deviceUuid, ip, userAgent, deviceName],
      );
      if (revived.length === 0) {
        await client.query(
          `INSERT INTO activations (license_id, device_uuid, device_name, last_ip, last_user_agent)
                VALUES ($1, $2, $3, $4::inet, $5)`,
          [lic.id, deviceUuid, deviceName, ip, userAgent],
        );
      }
    }

    // Recount for the response body (post-insert).
    const { rows: finalCount } = await client.query(
      `SELECT COUNT(*)::int AS live FROM activations WHERE license_id = $1 AND revoked_at IS NULL`,
      [lic.id],
    );

    await client.query('COMMIT');

    return res.status(200).json({
      ok: true,
      license_id: lic.id,
      email: lic.email,
      seats: lic.seats,
      seats_used: finalCount[0].live,
      expires_at: lic.expires_at,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[activate] db error:', e.message);
    return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Activation failed — try again in a moment.' } });
  } finally {
    client.release();
  }
};
