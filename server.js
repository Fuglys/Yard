// Yard Manager v2 — Express entry point
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { yardPool } = require('./lib/db');
const bus = require('./lib/eventBus');

const app = express();
const PORT = process.env.PORT || 3006;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── v2 API ──────────────────────────────────────────────────────────────
app.use('/api',           require('./routes/state')); // mounts /state, /state/since, /sync/v2
app.use('/api/materials', require('./routes/materials'));
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/events',    require('./routes/events'));

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), connectedClients: bus.count() });
});

// ── Wipe layout (admin) ─────────────────────────────────────────────────
// Hard delete uit DB. Stuurt 'wiped' event zodat clients hun lokale IndexedDB ook leegmaken
// (pullDiff alleen kijkt naar updated_at/deleted_at en weet dus niet van hard deletes).
app.post('/api/wipe-layout', async (req, res) => {
  const client = await yardPool.connect();
  try {
    await client.query('BEGIN');
    const cellsDel = await client.query('DELETE FROM cells');
    const areasDel = await client.query('DELETE FROM areas');
    await client.query('COMMIT');
    bus.broadcast('wiped', { ts: Date.now() });
    res.json({ ok: true, cells: cellsDel.rowCount, areas: areasDel.rowCount });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Wipe layout error:', err);
    res.status(500).json({ error: 'Wipe failed' });
  } finally {
    client.release();
  }
});

// ── Legacy endpoints (backward compat met oude index.html) ──────────────
// Verwijder zodra alle tablets de nieuwe versie draaien.

app.get('/api/cells', async (req, res) => {
  try {
    const { rows } = await yardPool.query(
      'SELECT row_num, layer, type, updated_at FROM yard_cells ORDER BY row_num, layer'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/sync', async (req, res) => {
  // Behouden voor oude tablets — niet aanpassen
  const { changes } = req.body || {};
  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: 'No changes provided' });
  }
  const valid = changes.filter(c =>
    c.row_num != null && c.layer != null && !isNaN(Number(c.layer)) && c.type !== undefined
  );
  if (valid.length === 0) return res.json({ ok: true, applied: 0, skipped: changes.length });

  const client = await yardPool.connect();
  try {
    await client.query('BEGIN');
    let applied = 0;
    for (const c of valid) {
      const r = await client.query(`
        INSERT INTO yard_cells (row_num, layer, type, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (row_num, layer) DO UPDATE
          SET type = $3, updated_at = $4
          WHERE yard_cells.updated_at < $4
      `, [c.row_num, Number(c.layer), c.type || 'Empty', c.updated_at || Date.now()]);
      applied += r.rowCount;
    }
    await client.query('COMMIT');
    res.json({ ok: true, applied, skipped: changes.length - valid.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Sync failed' });
  } finally { client.release(); }
});

app.get('/api/balen', async (req, res) => {
  try {
    const { rows } = await yardPool.query(
      'SELECT id, section_id, material, width, height, sort_order, updated_at FROM balen_items ORDER BY section_id, sort_order'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.get('/api/layout', async (req, res) => {
  try {
    const { rows } = await yardPool.query(
      'SELECT col, row, cell_type, label, meta, updated_at FROM yard_layout ORDER BY row, col'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

// ── Start ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Yard Manager v2] Server listening on :${PORT}`);
  console.log(`  - Static:    public/`);
  console.log(`  - DB:        ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
});
