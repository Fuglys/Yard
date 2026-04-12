require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3006;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const dagstartPool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  database: 'dagstart_db',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// GET materials from dagstart_db (non-test only)
app.get('/api/materials', async (req, res) => {
  try {
    const { rows } = await dagstartPool.query(
      "SELECT id, name FROM materials WHERE is_test = false AND is_active = true ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/materials error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET all cells — tablet pulls full state on reconnect
app.get('/api/cells', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT row_num, layer, type, updated_at FROM yard_cells ORDER BY row_num, layer'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/cells error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST sync — tablet pushes offline changes
// Each change: { row_num, layer, type, updated_at }
// Server uses "last write wins" based on updated_at
app.post('/api/sync', async (req, res) => {
  const { changes } = req.body;
  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: 'No changes provided' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let applied = 0;

    for (const c of changes) {
      const { row_num, layer, type, updated_at } = c;
      // Upsert: only apply if incoming timestamp is newer
      const result = await client.query(`
        INSERT INTO yard_cells (row_num, layer, type, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (row_num, layer) DO UPDATE
          SET type = $3, updated_at = $4
          WHERE yard_cells.updated_at < $4
      `, [row_num, layer, type, updated_at]);
      applied += result.rowCount;
    }

    await client.query('COMMIT');
    res.json({ ok: true, applied });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/sync error:', err);
    res.status(500).json({ error: 'Sync failed' });
  } finally {
    client.release();
  }
});

// POST auth login (dagstart users, admin/supervisor only)
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Vul beide velden in' });
  try {
    const { rows } = await dagstartPool.query(
      "SELECT id, username, password_hash, role, is_active FROM users WHERE username = $1 OR email = $1",
      [username]
    );
    console.log('Login attempt:', username, '- found:', rows.length, 'users');
    if (rows.length === 0) return res.status(401).json({ error: 'Gebruiker niet gevonden' });
    const user = rows[0];
    console.log('User:', user.username, 'role:', user.role, 'active:', user.is_active);
    if (!user.is_active) return res.status(401).json({ error: 'Account niet actief' });
    if (user.role !== 'admin' && user.role !== 'supervisor') return res.status(403).json({ error: 'Geen admin rechten' });
    const bcrypt = require('bcrypt');
    const match = await bcrypt.compare(password, user.password_hash);
    console.log('Password match:', match);
    if (!match) return res.status(401).json({ error: 'Onjuist wachtwoord' });
    res.json({ ok: true, username: user.username, role: user.role });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: 'Server fout' });
  }
});

// GET all materials including test (for balen bunkers)
app.get('/api/materials-all', async (req, res) => {
  try {
    const { rows } = await dagstartPool.query(
      "SELECT id, name, is_test FROM materials WHERE is_active = true ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/materials-all error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET balen items
app.get('/api/balen', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, section_id, material, width, height, sort_order, updated_at FROM balen_items ORDER BY section_id, sort_order'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/balen error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST balen sync
app.post('/api/balen/sync', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Invalid' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Delete all and re-insert (simple full sync)
    await client.query('DELETE FROM balen_items');
    for (const item of items) {
      await client.query(
        'INSERT INTO balen_items (section_id, material, width, height, sort_order, updated_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [item.section_id, item.material, item.width || 1, item.height || 1, item.sort_order || 0, item.updated_at || Date.now()]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/balen/sync error:', err);
    res.status(500).json({ error: 'Sync failed' });
  } finally {
    client.release();
  }
});

// GET yard layout
app.get('/api/layout', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT col, row, cell_type, label, meta, updated_at FROM yard_layout ORDER BY row, col');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/layout error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST layout sync
app.post('/api/layout/sync', async (req, res) => {
  const { cells } = req.body;
  if (!Array.isArray(cells)) return res.status(400).json({ error: 'Invalid' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of cells) {
      if (c.cell_type === 'empty' || !c.cell_type) {
        await client.query('DELETE FROM yard_layout WHERE col=$1 AND row=$2', [c.col, c.row]);
      } else {
        await client.query(`
          INSERT INTO yard_layout (col, row, cell_type, label, meta, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (col, row) DO UPDATE SET cell_type=$3, label=$4, meta=$5, updated_at=$6
          WHERE yard_layout.updated_at < $6
        `, [c.col, c.row, c.cell_type, c.label || '', JSON.stringify(c.meta || {}), c.updated_at || Date.now()]);
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/layout/sync error:', err);
    res.status(500).json({ error: 'Sync failed' });
  } finally { client.release(); }
});

app.listen(PORT, () => {
  console.log(`Yard Manager server running on port ${PORT}`);
});
