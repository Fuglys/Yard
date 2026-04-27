// Migratie runner — voert alle .sql bestanden in volgorde uit.
// Veilig her-uitvoerbaar (alle DDL is IF NOT EXISTS).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function run() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await client.connect();
  console.log(`Connected to ${process.env.DB_NAME} on ${process.env.DB_HOST}:${process.env.DB_PORT}`);

  const files = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    console.log(`\n→ Running ${file}`);
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
    try {
      await client.query(sql);
      console.log(`✓ ${file} done`);
    } catch (err) {
      console.error(`✗ ${file} failed:`, err.message);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log('\nAll migrations applied.');
}

run().catch(err => {
  console.error('Migration runner error:', err);
  process.exit(1);
});
