require('dotenv').config();
const { Client } = require('pg');

async function init() {
  // Step 1: Connect to default 'postgres' database to create yard_db
  const adminClient = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await adminClient.connect();

  const dbName = process.env.DB_NAME;
  const res = await adminClient.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]
  );

  if (res.rowCount === 0) {
    await adminClient.query(`CREATE DATABASE ${dbName}`);
    console.log(`Database "${dbName}" created.`);
  } else {
    console.log(`Database "${dbName}" already exists.`);
  }

  await adminClient.end();

  // Step 2: Connect to yard_db and create table
  const appClient = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: dbName,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await appClient.connect();

  await appClient.query(`
    CREATE TABLE IF NOT EXISTS yard_cells (
      row_num    INTEGER NOT NULL,
      layer      INTEGER NOT NULL,
      type       VARCHAR(60) NOT NULL DEFAULT 'Empty',
      updated_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (row_num, layer)
    );
  `);
  console.log('Table "yard_cells" created (or already exists).');

  await appClient.query(`
    CREATE TABLE IF NOT EXISTS balen_items (
      id          SERIAL PRIMARY KEY,
      section_id  INTEGER NOT NULL,
      material    VARCHAR(80) NOT NULL,
      width       INTEGER NOT NULL DEFAULT 1,
      height      INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      updated_at  BIGINT NOT NULL DEFAULT 0
    );
  `);
  console.log('Table "balen_items" created (or already exists).');

  await appClient.query(`
    CREATE TABLE IF NOT EXISTS yard_layout (
      col        INTEGER NOT NULL,
      row        INTEGER NOT NULL,
      cell_type  VARCHAR(30) NOT NULL,
      label      VARCHAR(80) DEFAULT '',
      meta       JSONB DEFAULT '{}',
      updated_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (col, row)
    );
  `);
  console.log('Table "yard_layout" created (or already exists).');

  await appClient.end();
}

init().catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
