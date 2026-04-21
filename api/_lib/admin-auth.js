// Bearer-token guard for /api/admin/* endpoints.
// Valid bearer == ADMIN_TOKEN env var. Constant-time compare to avoid
// timing side-channels. Returns true if the caller is allowed, false otherwise;
// also writes the 401 response so callers can early-return.

const crypto = require('crypto');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function checkAdmin(req, res) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    res.status(500).json({ error: 'ADMIN_TOKEN not set on server' });
    return false;
  }
  const hdr = req.headers.authorization || '';
  const m = hdr.match(/^Bearer\s+(.+)$/);
  if (!m || !safeEqual(m[1].trim(), expected)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="pier-admin"');
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

module.exports = { checkAdmin };
