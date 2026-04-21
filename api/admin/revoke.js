// POST /api/admin/revoke  — revoke a license OR a single device
// Body: { license_id, reason?, activation_id?, unrevoke? }
//
// If activation_id is present, revokes just that device row (freeing its seat).
// Else revokes the whole license (all current + future activations refused).
// unrevoke=true flips the revoked_at back to NULL.

const { query } = require('../_lib/db');
const { checkAdmin } = require('../_lib/admin-auth');

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

module.exports = async function handler(req, res) {
  if (!checkAdmin(req, res)) return;
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }

  let body;
  try { body = await readJsonBody(req); }
  catch { return res.status(400).json({ error: 'invalid json' }); }
  const { license_id, activation_id, reason, unrevoke } = body;
  if (!license_id) return res.status(400).json({ error: 'license_id required' });

  try {
    if (activation_id) {
      const col = unrevoke ? 'NULL' : 'NOW()';
      const { rows } = await query(
        `UPDATE activations SET revoked_at = ${col}
          WHERE id = $1 AND license_id = $2
        RETURNING id, device_uuid, revoked_at`,
        [activation_id, license_id],
      );
      if (rows.length === 0) return res.status(404).json({ error: 'activation not found' });
      return res.status(200).json({ ok: true, activation: rows[0] });
    }
    const col = unrevoke ? 'NULL' : 'NOW()';
    const { rows } = await query(
      `UPDATE licenses SET revoked_at = ${col}, revoke_reason = $2
        WHERE id = $1
      RETURNING id, revoked_at, revoke_reason`,
      [license_id, unrevoke ? null : (reason || null)],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'license not found' });
    return res.status(200).json({ ok: true, license: rows[0] });
  } catch (e) {
    console.error('[admin/revoke]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
