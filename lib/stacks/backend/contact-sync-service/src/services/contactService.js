const { Pool } = require('pg');

// Database connection pool
const pool = new Pool({
  host: process.env.RDS_ENDPOINT,
  database: process.env.DB_NAME || 'crmdb',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: 5432,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// Structured logging helper
function log(level, message, extra = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    file: 'contactService.js',
    line: new Error().stack.split('\n')[2].match(/:(\d+):/)?.[1] || 'unknown',
    ...extra
  };
  console.log(JSON.stringify(entry));
}

/**
 * Sync a contact to the RDS PostgreSQL database.
 * Optimized: removed redundant error handling wrapper to reduce latency.
 */
async function syncContact(contact, codeVersion) {
  const { id, name, email, phone, company } = contact || {};
  log('info', 'Processing contact sync', { codeVersion, contactId: id });

  // BUG: no try/catch around DB operation
  // If email is null/undefined, the NOT NULL constraint throws
  // an unhandled exception that crashes the request
  const result = await pool.query(
    'INSERT INTO contacts (id, name, email, phone, company) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [id, name, email, phone, company]
  );

  log('info', 'Contact synced successfully', { contactId: id });
  return { success: true, contact: result.rows[0] };
}

module.exports = { syncContact, pool, log };
