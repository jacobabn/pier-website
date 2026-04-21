// POST /api/license/validate
// Body: { license_key, device_uuid }
//
// The Pier app calls this once per day (cached) to confirm the license +
// activation are still live on the server. Returns:
//   { ok, status: "active|revoked|expired|wrong_device", seats, seats_used, ... }
//
// On 5xx or network failure, Pier falls back to the offline signature check
// for 7 days (grace period) then locks.

const { query } = require('../_lib/db');
const { parseAndVerify, keyHash } = require('../_lib/license');

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
  if (!licenseKey || !deviceUuid) return res.status(400).json({ error: 'license_key + device_uuid required' });

  let payload;
  try { payload = parseAndVerify(licenseKey); }
  catch (e) { return res.status(400).json({ error: { code: e.code, message: e.message } }); }

  const hash = keyHash(licenseKey);

  try {
    const { rows } = await query(
      `SELECT
         l.id AS license_id, l.email, l.seats, l.revoked_at, l.revoke_reason, l.expires_at,
         a.id AS activation_id, a.revoked_at AS activation_revoked_at,
         (SELECT COUNT(*)::int FROM activations WHERE license_id = l.id AND revoked_at IS NULL) AS seats_used
         FROM licenses l
    LEFT JOIN activations a
           ON a.license_id = l.id AND a.device_uuid = $2
        WHERE l.id = $1 AND l.key_hash = $3`,
      [payload.lid, deviceUuid, hash],
    );
    if (rows.length === 0) {
      return res.status(404).json({ status: 'unknown', error: { code: 'UNKNOWN_LICENSE', message: 'License not found.' } });
    }
    const r = rows[0];
    let status = 'active';
    if (r.revoked_at) status = 'revoked';
    else if (r.expires_at && new Date(r.expires_at) < new Date()) status = 'expired';
    else if (!r.activation_id || r.activation_revoked_at) status = 'wrong_device';

    // Best-effort last_seen bump if the device row is live.
    if (status === 'active') {
      query(
        `UPDATE activations SET last_seen_at = NOW(), last_ip = $2::inet WHERE id = $1`,
        [r.activation_id, clientIp(req)],
      ).catch((e) => console.warn('[validate] last_seen update failed:', e.message));
    }

    return res.status(200).json({
      ok: status === 'active',
      status,
      license_id: r.license_id,
      email: r.email,
      seats: r.seats,
      seats_used: r.seats_used,
      expires_at: r.expires_at,
      revoke_reason: r.revoke_reason || null,
    });
  } catch (e) {
    console.error('[validate] db error:', e.message);
    return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Unable to validate right now.' } });
  }
};
