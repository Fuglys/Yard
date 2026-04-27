// Database connection pools.
// Twee aparte pools omdat materials uit dagstart_db komen (read-only voor ons).
const { Pool } = require('pg');

const yardPool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
});

const dagstartPool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  database: 'dagstart_db',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 5,
});

yardPool.on('error', (err) => console.error('yardPool error:', err));
dagstartPool.on('error', (err) => console.error('dagstartPool error:', err));

module.exports = { yardPool, dagstartPool };
