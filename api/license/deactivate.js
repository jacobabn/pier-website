// POST /api/license/deactivate
// Body: { license_key, device_uuid }
//
// Marks this device's activation row as revoked, freeing one seat.
// Idempotent — calling twice is a no-op on the second call.
//
// Authz: the license_key itself is the authorization token for deactivating
// its own devices. No admin token needed. This mirrors what Pier Settings
// sends when a customer clicks "Deactivate this Mac".

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
    const { rows: licRows } = await query(
      'SELECT id FROM licenses WHERE id = $1 AND key_hash = $2',
      [payload.lid, hash],
    );
    if (licRows.length === 0) return res.status(404).json({ error: { code: 'UNKNOWN_LICENSE' } });
    const { rows: upd } = await query(
      `UPDATE activations
          SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE license_id = $1 AND device_uuid = $2
      RETURNING id, revoked_at`,
      [licRows[0].id, deviceUuid],
    );
    const { rows: [{ live }] } = await query(
      'SELECT COUNT(*)::int AS live FROM activations WHERE license_id = $1 AND revoked_at IS NULL',
      [licRows[0].id],
    );
    return res.status(200).json({
      ok: true,
      deactivated: upd.length > 0,
      seats_used: live,
    });
  } catch (e) {
    console.error('[deactivate] db error:', e.message);
    return res.status(500).json({ error: { code: 'SERVER_ERROR' } });
  }
};
