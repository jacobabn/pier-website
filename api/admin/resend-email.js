// POST /api/admin/resend-email  — re-send a license email by re-minting a key.
// Body: { license_id }
//
// Important: the license_key field is NOT stored in the DB (only the hash).
// "Resend" therefore means: mint a fresh key with the SAME lid + email + seats,
// update key_hash + key_display to the new one, email the customer. The old
// key becomes invalid (its hash no longer exists in the DB). This is the
// right default — if the customer lost the key, a refreshed key is safer.
// Activations continue to work because they're keyed on license_id, not key.

const { query } = require('../_lib/db');
const { mint, keyHash, keyDisplay } = require('../_lib/license');
const { checkAdmin } = require('../_lib/admin-auth');
const { renderPurchaseEmail } = require('../_lib/email-template');
const Stripe = require('stripe');
const { Resend } = require('resend');

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
  const licenseId = body.license_id;
  if (!licenseId) return res.status(400).json({ error: 'license_id required' });

  try {
    const { rows } = await query(
      'SELECT id, email, seats, expires_at, revoked_at, stripe_session_id FROM licenses WHERE id = $1',
      [licenseId],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'license not found' });
    const lic = rows[0];
    if (lic.revoked_at) return res.status(400).json({ error: 'license is revoked — un-revoke first if re-issuing' });

    // Re-sign with the SAME lid, same email + seats (mint() would generate a
    // fresh lid; here we need to preserve the license_id).
    const crypto = require('crypto');
    const priv = crypto.createPrivateKey({ key: process.env.PIER_LICENSE_PRIVATE_KEY_PEM, format: 'pem' });
    const payload = {
      v: 1,
      lid: lic.id,
      email: lic.email,
      seats: lic.seats,
      iat: Math.floor(Date.now() / 1000),
      prod: 'pier',
      iss: 'pier.abn.company',
    };
    if (lic.expires_at) payload.exp = Math.floor(new Date(lic.expires_at).getTime()/1000);
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const sigB64 = crypto.sign(null, Buffer.from(payloadB64,'utf8'), priv).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const licenseString = `pier_${payloadB64}.${sigB64}`;

    // Refresh key_hash + key_display in the DB.
    await query(
      `UPDATE licenses SET key_hash = $2, key_display = $3 WHERE id = $1`,
      [lic.id, keyHash(licenseString), keyDisplay(licenseString)],
    );

    // If this license came from Stripe, pull the invoice + session so the
    // email renders the same way the post-purchase email does (with totals +
    // PDF links). Licenses issued via /api/admin/licenses have no Stripe
    // session, so the invoice/session stay null and the template renders
    // with a default €199,00 total.
    let invoice = null;
    let session = null;
    if (lic.stripe_session_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
        session = await stripe.checkout.sessions.retrieve(lic.stripe_session_id);
        if (session.invoice) {
          invoice = await stripe.invoices.retrieve(session.invoice);
        }
      } catch (e) {
        console.warn('[resend-email] stripe fetch failed:', e.message);
      }
    }

    // Email via Resend.
    let emailStatus = 'skipped';
    if (process.env.RESEND_API_KEY) {
      const { subject, html, text } = renderPurchaseEmail({
        licenseKey: licenseString,
        email: lic.email,
        invoice,
        session,
        resend: true,
      });
      const r = new Resend(process.env.RESEND_API_KEY);
      const { data, error } = await r.emails.send({
        from: 'Pier <noreply@pier.abn.company>',
        to: lic.email,
        subject,
        html,
        text,
      });
      emailStatus = error ? `error: ${error.message}` : `sent (id=${data?.id})`;
    }

    return res.status(200).json({
      ok: true,
      license_id: lic.id,
      email: lic.email,
      license_key: licenseString, // also returned so admin can copy it manually
      email_status: emailStatus,
    });
  } catch (e) {
    console.error('[admin/resend-email]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
