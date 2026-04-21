// GET  /api/admin/licenses                         — list all, newest first
// GET  /api/admin/licenses?id=<uuid>                — one row + its activations
// POST /api/admin/licenses                          — manual create (comp/bank-transfer)
//       body: { email, seats?, expires_at?, source? }  → returns { license_key, license_id }
//
// Bearer-token authenticated.

const { query } = require('../_lib/db');
const { mint, keyHash, keyDisplay } = require('../_lib/license');
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

  if (req.method === 'GET') {
    const id = req.query?.id || (new URL(req.url, 'http://x').searchParams.get('id'));
    try {
      if (id) {
        const { rows: licRows } = await query(
          `SELECT id, email, seats, key_display, issued_at, expires_at, revoked_at, revoke_reason,
                  source, stripe_session_id, metadata,
                  (SELECT COUNT(*)::int FROM activations a WHERE a.license_id = l.id AND a.revoked_at IS NULL) AS seats_used
             FROM licenses l
            WHERE id = $1`,
          [id],
        );
        if (licRows.length === 0) return res.status(404).json({ error: 'not found' });
        const { rows: acts } = await query(
          `SELECT id, device_uuid, device_name, first_activated_at, last_seen_at, last_ip::text AS last_ip,
                  last_user_agent, revoked_at
             FROM activations
            WHERE license_id = $1
         ORDER BY first_activated_at DESC`,
          [id],
        );
        return res.status(200).json({ license: licRows[0], activations: acts });
      }
      // List view — summary only, paginated by issued_at DESC.
      const { rows } = await query(
        `SELECT id, email, seats, seats_used, seats_left, key_display, issued_at, expires_at,
                revoked_at, revoke_reason, source
           FROM license_summary
       ORDER BY issued_at DESC
          LIMIT 500`,
      );
      return res.status(200).json({ licenses: rows });
    } catch (e) {
      console.error('[admin/licenses GET]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req); }
    catch { return res.status(400).json({ error: 'invalid json' }); }
    const email = (body.email || '').trim();
    const seats = Number(body.seats ?? 2);
    const expiresAt = body.expires_at || null;
    const source = body.source && ['manual','comp'].includes(body.source) ? body.source : 'manual';
    if (!email || !/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'valid email required' });
    if (!Number.isFinite(seats) || seats < 1 || seats > 50) return res.status(400).json({ error: 'seats must be 1..50' });

    try {
      const { licenseString, payload } = mint({ email, seats, expiresAt });
      await query(
        `INSERT INTO licenses (id, email, seats, key_hash, key_display, source, expires_at, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          payload.lid, email, seats,
          keyHash(licenseString), keyDisplay(licenseString), source,
          expiresAt, JSON.stringify({ created_via: 'admin' }),
        ],
      );
      return res.status(200).json({
        license_id: payload.lid,
        license_key: licenseString, // ONLY shown once — admin should save it
        email, seats, expires_at: expiresAt, source,
      });
    } catch (e) {
      console.error('[admin/licenses POST]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed' });
};
