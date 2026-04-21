// Thin wrapper around node-postgres that:
//   - Reuses one connected pool per serverless process (Vercel reuses warm
//     instances; creating a new Client per request burns connection slots on
//     the Supabase free tier, which is only 60 max on the pooler).
//   - Strips the `sslmode=require` URL param because pg v9 reinterprets it
//     as verify-full; we want to pass `{ rejectUnauthorized: false }` for
//     Supabase's self-signed chain instead.
//   - Uses the pooled URL by default (short-lived webhook + API calls).
//     DDL scripts should import `getPool({ pooling: false })` for a direct
//     connection to the 5432 port.

const { Pool } = require('pg');

let cached = null;
let cachedNonPool = null;

function buildPool(url) {
  const clean = url.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '');
  return new Pool({
    connectionString: clean,
    ssl: { rejectUnauthorized: false },
    max: 3,           // serverless instances should not hog the pool
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
}

function getPool({ pooling = true } = {}) {
  if (pooling) {
    if (cached) return cached;
    const url = process.env.POSTGRES_URL;
    if (!url) throw new Error('POSTGRES_URL not set');
    cached = buildPool(url);
    return cached;
  }
  if (cachedNonPool) return cachedNonPool;
  const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!url) throw new Error('POSTGRES_URL_NON_POOLING not set');
  cachedNonPool = buildPool(url);
  return cachedNonPool;
}

async function query(sql, params) {
  const pool = getPool();
  return pool.query(sql, params);
}

module.exports = { getPool, query };
