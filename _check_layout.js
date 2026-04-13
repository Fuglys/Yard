require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: 'yard_db', user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  await c.connect();
  
  const count = await c.query('SELECT COUNT(*) FROM yard_layout');
  console.log('Layout rows:', count.rows[0].count);
  
  const sample = await c.query('SELECT * FROM yard_layout ORDER BY updated_at DESC LIMIT 5');
  console.log('Latest 5:');
  sample.rows.forEach(r => console.log(`  col=${r.col} row=${r.row} type=${r.cell_type} label=${r.label} updated=${new Date(parseInt(r.updated_at))}`));
  
  const cells = await c.query('SELECT COUNT(*) FROM yard_cells');
  console.log('\nYard cells rows:', cells.rows[0].count);
  
  await c.end();
})();
