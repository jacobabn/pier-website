// pier.abn.company/api/webhooks/stripe — Stripe → Ed25519 license → email.
//
// Flow on a checkout.session.completed event:
//   1. Verify the Stripe signature (requires raw body + STRIPE_WEBHOOK_SECRET).
//   2. Idempotency check: if the session already has metadata.pier_license_id,
//      return 200 (Stripe retried) — never double-issue.
//   3. Read the customer email from the session.
//   4. Mint a fresh license_id + signed Ed25519 token with PIER_LICENSE_PRIVATE_KEY_PEM.
//   5. Stamp the license_id back into the Stripe session's metadata (audit trail).
//   6. Email the customer the license via Resend.
//   7. Return 200.
//
// Auth chain:
//   - Stripe signature keeps random callers from forging "purchase" events.
//   - Private key lives only in Vercel env + ~/.pier-ops/ on the signing Mac,
//     never in git, never in the app bundle, never in a client response.
//   - Emails come from noreply@pier.abn.company — must be verified in Resend
//     before this actually sends. Before that, emails 422 but license is still
//     minted + persisted in Stripe metadata; we can resend by hand.
//
// This file is deliberately dependency-light: only `stripe` (for signature
// verification + session.update) and `resend` (email). Everything else is
// stdlib.

const Stripe = require('stripe');
const crypto = require('crypto');
const { Resend } = require('resend');
const { query } = require('../_lib/db');
const { mint, keyHash, keyDisplay } = require('../_lib/license');
const { renderPurchaseEmail } = require('../_lib/email-template');

// Disable Vercel's default JSON body parser — Stripe's signature
// verification requires the EXACT raw bytes of the request body.
module.exports.config = {
  api: { bodyParser: false },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Signing is in api/_lib/license.js — imported as `mint`.
// Email rendering is in api/_lib/email-template.js — imported as `renderPurchaseEmail`.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const resendKey = process.env.RESEND_API_KEY;
  if (!secret || !whSecret || !process.env.PIER_LICENSE_PRIVATE_KEY_PEM) {
    return res.status(500).json({ error: 'server not configured' });
  }

  const stripe = new Stripe(secret, { apiVersion: '2024-06-20' });
  let event;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(raw, sig, whSecret);
  } catch (err) {
    return res.status(400).json({ error: `signature verify failed: ${err.message}` });
  }

  if (event.type !== 'checkout.session.completed') {
    // Acknowledge everything else so Stripe stops retrying; we just don't act on it.
    return res.status(200).json({ received: true, skipped: true, type: event.type });
  }

  // Fetch the freshest session (constructEvent returns the snapshot from the
  // event envelope — fetching live gives us any updates that happened since
  // and guarantees customer_details is populated).
  const sessionId = event.data.object.id;
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  // Idempotency: if we already wrote a license for this Stripe session
  // (either via Stripe metadata OR via the UNIQUE stripe_session_id in the
  // DB), return the stored result.
  if (session.metadata && session.metadata.pier_license_id) {
    return res.status(200).json({
      received: true,
      idempotent: true,
      license_id: session.metadata.pier_license_id,
    });
  }

  const email =
    (session.customer_details && session.customer_details.email) ||
    session.customer_email ||
    null;
  if (!email) {
    return res.status(400).json({ error: 'no customer email on session' });
  }

  // Mint + sign
  let minted;
  try {
    minted = mint({ email, seats: 2 });
  } catch (err) {
    return res.status(500).json({ error: `license signing failed: ${err.message}` });
  }

  // Persist to DB FIRST so admin UI + activate API can see it immediately.
  // If stripe_session_id is already present (rare Stripe retry before our
  // metadata update completed), we surface the existing row and email again.
  try {
    await query(
      `INSERT INTO licenses (id, email, seats, key_hash, key_display, stripe_session_id, source, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'stripe', $7::jsonb)`,
      [
        minted.payload.lid,
        email,
        minted.payload.seats,
        keyHash(minted.licenseString),
        keyDisplay(minted.licenseString),
        sessionId,
        JSON.stringify({ stripe_customer_id: session.customer, amount_total: session.amount_total, currency: session.currency }),
      ],
    );
  } catch (e) {
    // Unique violation on stripe_session_id → earlier call already inserted.
    // Look up the existing row and return idempotently.
    if (/unique|duplicate/i.test(e.message)) {
      const { rows } = await query('SELECT id FROM licenses WHERE stripe_session_id = $1', [sessionId]);
      if (rows[0]) {
        return res.status(200).json({ received: true, idempotent: true, license_id: rows[0].id });
      }
    }
    console.error('[webhook] DB insert failed:', e.message);
    return res.status(500).json({ error: `db insert failed: ${e.message}` });
  }

  // Stamp into Stripe metadata so a retry BEFORE the DB commit lands still
  // no-ops on the fast path above.
  await stripe.checkout.sessions.update(sessionId, {
    metadata: {
      ...(session.metadata || {}),
      pier_license_id: minted.payload.lid,
      pier_email: email,
      pier_issued_at: String(minted.payload.iat),
    },
  });

  // Fetch the auto-generated Stripe invoice so the email can include a
  // proper tax receipt (PDF + hosted page). Best-effort — an older session
  // without invoice_creation enabled will have session.invoice === null.
  let invoice = null;
  if (session.invoice) {
    try { invoice = await stripe.invoices.retrieve(session.invoice); }
    catch (e) { console.warn('[webhook] invoice retrieve failed:', e.message); }
  }

  // Email — best effort. If Resend isn't configured yet we still return 200
  // (the license exists; Stripe retry would only cause a 4xx loop).
  let emailStatus = 'skipped';
  if (resendKey) {
    try {
      const { subject, html, text } = renderPurchaseEmail({
        licenseKey: minted.licenseString,
        email,
        invoice,
        session,
      });
      const resend = new Resend(resendKey);
      const { data, error } = await resend.emails.send({
        from: 'Pier <noreply@pier.abn.company>',
        to: email,
        subject,
        html,
        text,
      });
      if (error) {
        emailStatus = `error: ${error.message || String(error)}`;
      } else {
        emailStatus = `sent (id=${data && data.id})`;
      }
    } catch (err) {
      emailStatus = `threw: ${err.message}`;
    }
  }

  return res.status(200).json({
    received: true,
    license_id: minted.payload.lid,
    email,
    email_status: emailStatus,
  });
};
