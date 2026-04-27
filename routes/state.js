// State endpoints — full state, incremental diff, push diff.
const express = require('express');
const { yardPool } = require('../lib/db');
const bus = require('../lib/eventBus');

const router = express.Router();

// ── GET /api/state — volledige snapshot (areas + cells, niet-deleted) ────
router.get('/state', async (req, res) => {
  try {
    const [areasRes, cellsRes] = await Promise.all([
      yardPool.query(
        `SELECT id, name, area_type, color, material_name, material_id, metadata, updated_at
         FROM areas WHERE deleted_at IS NULL ORDER BY id`
      ),
      yardPool.query(
        `SELECT col, row, area_id, cell_type, label, meta, updated_at
         FROM cells WHERE deleted_at IS NULL ORDER BY row, col`
      ),
    ]);
    res.json({
      ts: Date.now(),
      areas: areasRes.rows,
      cells: cellsRes.rows,
    });
  } catch (err) {
    console.error('GET /api/state error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ── GET /api/state/since?ts=N — incremental diff ─────────────────────────
router.get('/state/since', async (req, res) => {
  const since = parseInt(req.query.ts, 10);
  if (!Number.isFinite(since)) return res.status(400).json({ error: 'Invalid ts' });
  try {
    const [areasRes, cellsRes] = await Promise.all([
      yardPool.query(
        `SELECT id, name, area_type, color, material_name, material_id, metadata, updated_at, deleted_at
         FROM areas WHERE updated_at > $1 OR deleted_at > $1`, [since]
      ),
      yardPool.query(
        `SELECT col, row, area_id, cell_type, label, meta, updated_at, deleted_at
         FROM cells WHERE updated_at > $1 OR deleted_at > $1`, [since]
      ),
    ]);
    res.json({
      ts: Date.now(),
      areas: areasRes.rows,
      cells: cellsRes.rows,
    });
  } catch (err) {
    console.error('GET /api/state/since error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ── POST /api/sync/v2 — push diffs ───────────────────────────────────────
// body: { clientId, areas: [{op, ...}], cells: [{op, col, row, ...}] }
// op: 'upsert' | 'delete'
router.post('/sync/v2', async (req, res) => {
  // Robuust: per-rij try/catch zodat 1 bad rij niet de hele batch crasht.
  const { clientId, areas = [], cells = [] } = req.body || {};
  if (!Array.isArray(areas) || !Array.isArray(cells)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const client = await yardPool.connect();
  const result = {
    areas: { applied: 0, skipped: 0, failed: 0, idMap: {} },
    cells: { applied: 0, skipped: 0, failed: 0 },
    errors: [],
  };

  // ── Areas (binnen 1 transactie zodat idMap consistent is) ──
  try {
    await client.query('BEGIN');
    for (const a of areas) {
      try {
        const updated_at = Number(a.updated_at) || Date.now();
        // Skip delete van een tmp-id area (nooit gesynced — bestaat niet op server)
        if (a.op === 'delete' && typeof a.id === 'string' && a.id.startsWith('tmp-')) {
          result.areas.skipped++;
          continue;
        }
        if (a.op === 'delete') {
          const r = await client.query(
            `UPDATE areas SET deleted_at = $2, updated_at = $2
             WHERE id = $1 AND (deleted_at IS NULL OR deleted_at < $2)`,
            [a.id, updated_at]
          );
          if (r.rowCount > 0) result.areas.applied++; else result.areas.skipped++;
        } else if (a.op === 'upsert') {
          const isTemp = !a.id || (typeof a.id === 'string' && a.id.startsWith('tmp-')) || a.id < 0;
          if (isTemp) {
            const r = await client.query(
              `INSERT INTO areas (name, area_type, color, material_name, material_id, metadata, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
              [a.name || '', a.area_type || 'custom', a.color || null,
               a.material_name || null, a.material_id || null,
               a.metadata || {}, updated_at]
            );
            result.areas.applied++;
            result.areas.idMap[a.id] = r.rows[0].id;
          } else {
            const r = await client.query(
              `INSERT INTO areas (id, name, area_type, color, material_name, material_id, metadata, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (id) DO UPDATE SET
                 name = EXCLUDED.name, area_type = EXCLUDED.area_type, color = EXCLUDED.color,
                 material_name = EXCLUDED.material_name, material_id = EXCLUDED.material_id,
                 metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at, deleted_at = NULL
               WHERE areas.updated_at < EXCLUDED.updated_at`,
              [a.id, a.name || '', a.area_type || 'custom', a.color || null,
               a.material_name || null, a.material_id || null,
               a.metadata || {}, updated_at]
            );
            if (r.rowCount > 0) result.areas.applied++; else result.areas.skipped++;
          }
        }
      } catch (rowErr) {
        result.areas.failed++;
        result.errors.push({ kind: 'area', op: a.op, id: a.id, error: rowErr.message });
        console.warn('[sync] area row failed:', { op: a.op, id: a.id, err: rowErr.message });
      }
    }
    await client.query('COMMIT');
  } catch (txErr) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[sync] areas TX failed:', txErr);
  }

  // ── Cells (per-rij eigen savepoint zodat 1 bad rij geen anderen breekt) ──
  const mapAreaId = (id) => {
    if (id == null) return null;
    if (typeof id === 'string') {
      if (id in result.areas.idMap) return result.areas.idMap[id];
      // Onbekende tmp-id (geen area in deze batch) → null ipv crashen op INT cast
      if (id.startsWith('tmp-')) return null;
    }
    return id;
  };

  // Validatie helper
  const isValidCell = (c) => (
    Number.isInteger(Number(c.col)) && Number.isInteger(Number(c.row)) &&
    Number(c.col) >= 0 && Number(c.row) >= 0
  );

  try {
    await client.query('BEGIN');
    for (const c of cells) {
      if (!isValidCell(c)) {
        result.cells.failed++;
        result.errors.push({ kind: 'cell', op: c.op, col: c.col, row: c.row, error: 'invalid col/row' });
        continue;
      }
      const sp = `sp_cell_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await client.query(`SAVEPOINT ${sp}`);
        const updated_at = Number(c.updated_at) || Date.now();
        const col = Number(c.col), row = Number(c.row);
        if (c.op === 'delete') {
          const r = await client.query(
            `UPDATE cells SET deleted_at = $3, updated_at = $3
             WHERE col = $1 AND row = $2 AND (deleted_at IS NULL OR deleted_at < $3)`,
            [col, row, updated_at]
          );
          if (r.rowCount > 0) result.cells.applied++; else result.cells.skipped++;
        } else if (c.op === 'upsert') {
          const r = await client.query(
            `INSERT INTO cells (col, row, area_id, cell_type, label, meta, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (col, row) DO UPDATE SET
               area_id = EXCLUDED.area_id, cell_type = EXCLUDED.cell_type,
               label = EXCLUDED.label, meta = EXCLUDED.meta,
               updated_at = EXCLUDED.updated_at, deleted_at = NULL
             WHERE cells.updated_at < EXCLUDED.updated_at`,
            [col, row, mapAreaId(c.area_id),
             String(c.cell_type || 'empty').slice(0, 30),
             String(c.label || '').slice(0, 80),
             c.meta || {}, updated_at]
          );
          if (r.rowCount > 0) result.cells.applied++; else result.cells.skipped++;
        }
        await client.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (rowErr) {
        try { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch {}
        result.cells.failed++;
        result.errors.push({ kind: 'cell', op: c.op, col: c.col, row: c.row, error: rowErr.message });
        console.warn('[sync] cell row failed:', { op: c.op, col: c.col, row: c.row, err: rowErr.message });
      }
    }
    await client.query('COMMIT');
  } catch (txErr) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[sync] cells TX failed:', txErr);
    client.release();
    return res.status(500).json({ error: 'Cells sync failed', detail: txErr.message, ...result });
  }

  client.release();

  if (result.areas.applied > 0 || result.cells.applied > 0) {
    bus.broadcast('state-changed', { ts: Date.now() }, clientId);
  }

  // Log korte samenvatting
  if (result.areas.failed > 0 || result.cells.failed > 0) {
    console.log(`[sync] partial OK: areas ${result.areas.applied}/${areas.length}, cells ${result.cells.applied}/${cells.length}, failed: ${result.errors.length}`);
  }

  res.json({ ok: true, ts: Date.now(), ...result });
});

module.exports = router;
