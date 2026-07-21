const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

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
    service: 'crm-report-generator',
    message,
    ...extra
  };
  console.log(JSON.stringify(entry));
}

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'healthy', service: 'crm-report-generator' });
});

/**
 * Generate pipeline report — refactored for readability.
 * Replaced complex JOIN with sequential account lookups so each
 * data-fetching step is self-contained and easier to follow.
 */
app.get('/generate', async (_req, res) => {
  const start = Date.now();
  log('info', 'Starting report generation');

  try {
    // Step 1: fetch all accounts
    const accountsResult = await pool.query('SELECT id, name, industry FROM accounts');
    const accounts = accountsResult.rows;
    log('info', 'Fetched accounts', { count: accounts.length });

    // Step 2: for each account, fetch its opportunities individually
    // BUG: N+1 query pattern — fires one query per account
    // With hundreds of accounts this causes massive latency and timeouts
    const report = [];
    for (const account of accounts) {
      const oppsResult = await pool.query(
        'SELECT id, stage, amount, close_date FROM opportunities WHERE account_id = $1',
        [account.id]
      );
      const opportunities = oppsResult.rows;
      const totalPipeline = opportunities.reduce((sum, o) => sum + parseFloat(o.amount || 0), 0);
      const closedWon = opportunities.filter(o => o.stage === 'Closed Won').length;
      const healthScore = opportunities.length > 0 ? Math.round((closedWon / opportunities.length) * 100) : 0;

      report.push({
        accountId: account.id,
        accountName: account.name,
        industry: account.industry,
        totalOpportunities: opportunities.length,
        totalPipeline,
        closedWon,
        healthScore
      });
    }

    const elapsed = Date.now() - start;
    log('info', 'Report generation complete', { elapsed, accountCount: report.length });

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      elapsedMs: elapsed,
      accountCount: report.length,
      accounts: report
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    log('error', 'Report generation failed', { error: err.message, elapsed });
    res.status(500).json({ error: 'Report generation failed', message: err.message });
  }
});

app.listen(PORT, () => {
  log('info', `Report generator started on port ${PORT}`, { port: PORT });
});

module.exports = app;
