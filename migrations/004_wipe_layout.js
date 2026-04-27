// Wis alle cells + areas (geen materialen, die zitten in dagstart_db).
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
  await c.query('BEGIN');
  const cellsDel = await c.query('DELETE FROM cells');
  const areasDel = await c.query('DELETE FROM areas');
  await c.query('COMMIT');
  await c.end();
  console.log(`Verwijderd: ${cellsDel.rowCount} cellen, ${areasDel.rowCount} areas`);
})().catch((e) => { console.error(e); process.exit(1); });
