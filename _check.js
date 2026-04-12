require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcrypt');
(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: 'dagstart_db', user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  await c.connect();
  const r = await c.query("SELECT username, password_hash FROM users WHERE username = 'gerrie.de.jong'");
  const user = r.rows[0];
  console.log('Hash:', user.password_hash);
  // Test with a dummy password
  const match = await bcrypt.compare('test123', user.password_hash);
  console.log('Match with test123:', match);
  await c.end();
})();
