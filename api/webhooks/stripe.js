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

function base64url(buf) {
  // Node 16+ supports Buffer.toString('base64url') directly. Stay compatible
  // with older build environments by normalising manually.
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function mintLicense({ email, seats = 2, privateKeyPem }) {
  const privKey = crypto.createPrivateKey({ key: privateKeyPem, format: 'pem' });
  if (privKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('PIER_LICENSE_PRIVATE_KEY_PEM is not an Ed25519 key');
  }
  const payload = {
    v: 1,
    lid: crypto.randomUUID(),
    email,
    seats,
    iat: Math.floor(Date.now() / 1000),
    prod: 'pier',
    iss: 'pier.abn.company',
  };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), privKey);
  const sigB64 = base64url(signature);
  return {
    licenseString: `pier_${payloadB64}.${sigB64}`,
    license_id: payload.lid,
    payload,
  };
}

function licenseEmailHtml(licenseString, email) {
  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;line-height:1.55;color:#14110E;max-width:560px;margin:24px auto;padding:0 16px;">
  <h1 style="font-size:22px;margin:0 0 16px;">Thanks for buying Pier.</h1>
  <p>Hi,</p>
  <p>Your license key is below. Paste it into Pier's <b>Settings → Activate</b>, and you're in. Works on 2 Macs.</p>
  <pre style="background:#f5f2ea;border:1px solid #d9d0b8;border-radius:8px;padding:14px;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Menlo,monospace;font-size:13px;">${licenseString}</pre>
  <p>If you haven't yet, download Pier here: <a href="https://pier.abn.company/download">pier.abn.company/download</a>.</p>
  <p>Keep this email safe — we can resend the key if you ever lose it, but you'll need it to activate on a new Mac.</p>
  <p style="color:#596458;font-size:13px;margin-top:32px;">Bought as ${email}. Any questions, just reply to this email.<br>— Jacob @ A Brand New Company</p>
</body></html>`;
}

function licenseEmailText(licenseString, email) {
  return [
    'Thanks for buying Pier.',
    '',
    'Your license key is below. Paste it into Pier\'s Settings → Activate.',
    'Works on 2 Macs.',
    '',
    licenseString,
    '',
    'If you haven\'t yet, download Pier from https://pier.abn.company/download',
    '',
    `Bought as ${email}. Any questions, just reply.`,
    '— Jacob @ A Brand New Company',
  ].join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const privateKeyPem = process.env.PIER_LICENSE_PRIVATE_KEY_PEM;
  const resendKey = process.env.RESEND_API_KEY;
  if (!secret || !whSecret || !privateKeyPem) {
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
    minted = mintLicense({ email, seats: 2, privateKeyPem });
  } catch (err) {
    return res.status(500).json({ error: `license signing failed: ${err.message}` });
  }

  // Stamp into Stripe metadata FIRST so a retry after a crash still sees the
  // license_id and no-ops correctly. (If the email later fails we can resend.)
  await stripe.checkout.sessions.update(sessionId, {
    metadata: {
      ...(session.metadata || {}),
      pier_license_id: minted.license_id,
      pier_email: email,
      pier_issued_at: String(minted.payload.iat),
    },
  });

  // Email — best effort. If Resend isn't configured yet we still return 200
  // (the license exists; Stripe retry would only cause a 4xx loop).
  let emailStatus = 'skipped';
  if (resendKey) {
    try {
      const resend = new Resend(resendKey);
      const { data, error } = await resend.emails.send({
        from: 'Pier <noreply@pier.abn.company>',
        to: email,
        subject: 'Your Pier license key',
        html: licenseEmailHtml(minted.licenseString, email),
        text: licenseEmailText(minted.licenseString, email),
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
    license_id: minted.license_id,
    email,
    email_status: emailStatus,
  });
};
