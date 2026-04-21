// Shared server-side license utilities: verify a license string, mint a new
// one. Mirrors ~/Desktop/ftp-manager/services/license-service.js parseAndVerify
// behaviour so a key that verifies here also verifies on the Pier.app side.

const crypto = require('crypto');

// Server-side public key — should match the one embedded in Pier.app.
// For test/dev we fall back to the env var PIER_LICENSE_PRIVATE_KEY_PEM and
// derive the public key from it. In production both signer + verifier share
// the same pair, so either approach works.
function getPublicKey() {
  const pub = process.env.PIER_LICENSE_PUBLIC_KEY_PEM;
  if (pub) return crypto.createPublicKey({ key: pub, format: 'pem' });
  const priv = process.env.PIER_LICENSE_PRIVATE_KEY_PEM;
  if (!priv) throw new Error('Neither PIER_LICENSE_PUBLIC_KEY_PEM nor PIER_LICENSE_PRIVATE_KEY_PEM set.');
  const privKey = crypto.createPrivateKey({ key: priv, format: 'pem' });
  return crypto.createPublicKey(privKey);
}

function getPrivateKey() {
  const priv = process.env.PIER_LICENSE_PRIVATE_KEY_PEM;
  if (!priv) throw new Error('PIER_LICENSE_PRIVATE_KEY_PEM not set');
  return crypto.createPrivateKey({ key: priv, format: 'pem' });
}

function base64urlOfBuf(buf) {
  return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64uToBuf(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/') + pad, 'base64');
}

/**
 * Parse + Ed25519-verify a license string. Returns the decoded payload on
 * success; throws with `.code` on failure. Shape: pier_<b64u(payload)>.<b64u(sig)>.
 */
function parseAndVerify(licenseString) {
  if (typeof licenseString !== 'string') throw tag('BAD_FORMAT','License must be a string.');
  const s = licenseString.trim();
  if (!s.startsWith('pier_')) throw tag('BAD_FORMAT','Must start with "pier_".');
  const rest = s.slice(5);
  const dot = rest.indexOf('.');
  if (dot <= 0) throw tag('BAD_FORMAT','Missing "." separator.');
  const payloadB64 = rest.slice(0, dot);
  const sigB64 = rest.slice(dot+1);
  let ok;
  try {
    ok = crypto.verify(null, Buffer.from(payloadB64,'utf8'), getPublicKey(), b64uToBuf(sigB64));
  } catch (e) {
    throw tag('BAD_SIGNATURE', `Verify threw: ${e.message}`);
  }
  if (!ok) throw tag('BAD_SIGNATURE','Signature does not match.');
  let payload;
  try { payload = JSON.parse(b64uToBuf(payloadB64).toString('utf8')); }
  catch { throw tag('BAD_PAYLOAD','Payload not valid JSON.'); }
  if (payload.v !== 1) throw tag('UNSUPPORTED_VER', `Version ${payload.v} not supported.`);
  if (payload.prod !== 'pier') throw tag('WRONG_PRODUCT', `Not a Pier license (${payload.prod}).`);
  if (!payload.lid || !payload.email || !Number.isFinite(payload.iat) || !Number.isFinite(payload.seats)) {
    throw tag('BAD_PAYLOAD','Payload missing required fields.');
  }
  if (payload.exp && Math.floor(Date.now()/1000) > payload.exp) throw tag('EXPIRED','License expired.');
  return payload;
}

function tag(code, message) { const e = new Error(message); e.code = code; return e; }

/**
 * Mint a fresh license from the server-held private key. Used by the Stripe
 * webhook + /api/admin/licenses create flow.
 */
function mint({ email, seats = 2, expiresAt = null }) {
  const priv = getPrivateKey();
  if (priv.asymmetricKeyType !== 'ed25519') throw new Error('Server key is not Ed25519.');
  const payload = {
    v: 1,
    lid: crypto.randomUUID(),
    email,
    seats,
    iat: Math.floor(Date.now()/1000),
    prod: 'pier',
    iss: 'pier.abn.company',
  };
  if (expiresAt) payload.exp = Math.floor(new Date(expiresAt).getTime()/1000);
  const payloadB64 = base64urlOfBuf(Buffer.from(JSON.stringify(payload),'utf8'));
  const signature = crypto.sign(null, Buffer.from(payloadB64,'utf8'), priv);
  const sigB64 = base64urlOfBuf(signature);
  const licenseString = `pier_${payloadB64}.${sigB64}`;
  return { payload, licenseString };
}

/** sha256(licenseString) — hex — used as the DB lookup key. Never store full key. */
function keyHash(licenseString) {
  return crypto.createHash('sha256').update(licenseString, 'utf8').digest('hex');
}

/** First-12 + last-4 chars, with an ellipsis. Only way a full key surfaces in admin UI. */
function keyDisplay(licenseString) {
  if (licenseString.length < 20) return licenseString;
  return `${licenseString.slice(0, 12)}…${licenseString.slice(-4)}`;
}

module.exports = { parseAndVerify, mint, keyHash, keyDisplay };
