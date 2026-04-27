// Layout uit handgetekende schets toepassen.
// - Zwart = muren
// - Rood  = Tent (custom area)
// - Wit (gestreept) = zakken-rijen
// Wist huidige cells/areas en plaatst nieuwe layout.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
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
  console.log('Connected.');

  // ── Helpers ─────────────────────────────────────────────────────
  const cells = [];
  const areas = []; // { tempId, name, area_type, color }
  let tempId = 0;

  const ts = Date.now();
  function addCell(col, row, cell_type, opts = {}) {
    cells.push({
      col, row,
      area_id: opts.area_id ?? null,
      cell_type,
      label: opts.label || '',
      meta: opts.meta || {},
      updated_at: ts,
    });
  }
  function addArea(name, area_type, color) {
    const a = { tempId: ++tempId, name, area_type, color };
    areas.push(a);
    return a.tempId;
  }
  function wallH(c1, c2, row) { for (let c = c1; c <= c2; c++) addCell(c, row, 'wall'); }
  function wallV(col, r1, r2) { for (let r = r1; r <= r2; r++) addCell(col, r, 'wall'); }
  function wallRect(c1, r1, c2, r2) {
    wallH(c1, c2, r1); wallH(c1, c2, r2);
    wallV(c1, r1, r2); wallV(c2, r1, r2);
  }
  function fillRect(c1, r1, c2, r2, cell_type, opts = {}) {
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++)
        addCell(c, r, cell_type, opts);
  }
  function zakRow(c1, c2, row) {
    for (let c = c1; c <= c2; c++) addCell(c, row, 'zak');
  }

  // ── Layout uit schets ────────────────────────────────────────────
  // Grid: ~ 70 cols × 30 rows

  // BOVEN-SECTIE (zakkenrijen + tent)
  // Boven en onder muren rond bovenste sectie
  wallH(0, 65, 0);   // bovenmuur
  wallV(0, 0, 7);    // linkermuur
  wallV(65, 0, 7);   // rechtermuur
  wallH(0, 65, 7);   // onderkant van bovensectie

  // Tent (twee rode vlakken aan linkerkant)
  const tent1 = addArea('Tent 1', 'custom', '#e74c3c');
  fillRect(2, 1, 5, 4, 'custom', { area_id: tent1 });
  const tent2 = addArea('Tent 2', 'custom', '#e74c3c');
  fillRect(7, 1, 10, 4, 'custom', { area_id: tent2 });

  // Drie zakkenrijen (horizontale stroken)
  zakRow(13, 64, 1);
  zakRow(13, 64, 3);
  zakRow(13, 64, 5);

  // ONDER-SECTIE (bunkers) — alleen muren, je kunt deuren maken door cellen te wissen in Indeling-modus
  // Linker bunker complex
  wallRect(3, 13, 28, 24);

  // Rechter bunker complex met sub-verdelingen
  wallRect(33, 13, 60, 24);
  wallV(48, 13, 24);          // verticale binnenwand
  wallH(49, 60, 18);          // horizontale binnenwand
  wallV(52, 19, 22);          // korte muur 1
  wallV(56, 19, 22);          // korte muur 2

  // Verbindingsbalk onderkant
  wallH(28, 33, 24);

  const finalCells = cells.slice();
  console.log(`Layout: ${finalCells.length} cellen, ${areas.length} areas`);

  // ── Database push ───────────────────────────────────────────────
  await client.query('BEGIN');
  await client.query('DELETE FROM cells');
  await client.query('DELETE FROM areas');

  // Insert areas
  const idMap = new Map();
  for (const a of areas) {
    const r = await client.query(
      `INSERT INTO areas (name, area_type, color, updated_at)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [a.name, a.area_type, a.color, ts]
    );
    idMap.set(a.tempId, r.rows[0].id);
  }
  console.log(`✓ ${areas.length} areas geïnserteerd`);

  // Insert cells in batches (deduped op col,row — laatste schrijver wint)
  const dedup = new Map();
  for (const c of finalCells) dedup.set(`${c.col},${c.row}`, c);
  const list = [...dedup.values()];

  const batchSize = 200;
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    const values = [];
    const params = [];
    batch.forEach((c, idx) => {
      const o = idx * 7;
      values.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7})`);
      params.push(
        c.col, c.row,
        c.area_id != null ? idMap.get(c.area_id) : null,
        c.cell_type, c.label, JSON.stringify(c.meta), c.updated_at
      );
    });
    await client.query(
      `INSERT INTO cells (col, row, area_id, cell_type, label, meta, updated_at)
       VALUES ${values.join(',')}`,
      params
    );
  }
  console.log(`✓ ${list.length} cellen geïnserteerd`);

  await client.query('COMMIT');
  await client.end();
  console.log('\nLayout toegepast.');
}

run().catch((err) => { console.error('Mislukt:', err); process.exit(1); });
