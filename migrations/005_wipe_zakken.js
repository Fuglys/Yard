// Verwijder alle zak en zak-num cellen uit yard_db. Houd andere cellen (muren, areas, etc.) intact.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();
  const r = await c.query(`DELETE FROM cells WHERE cell_type IN ('zak', 'zak-num')`);
  await c.end();
  console.log(`Verwijderd: ${r.rowCount} zak/zak-num cellen`);
})().catch((e) => { console.error(e); process.exit(1); });
