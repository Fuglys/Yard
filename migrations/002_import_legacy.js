// Eenmalige data-import: oude yard_layout + yard_cells (zak materiaal) → nieuwe cells/areas.
// - Alle layout cellen worden 1:1 nieuwe `cells` rijen (met passende cell_type)
// - Cellen met label/material worden gegroepeerd in `areas`:
//     * cell_type 'bunker-*'  → area_type='bunker',   name=label
//     * cell_type 'custom-*'  → area_type='custom',   name=label, color=meta.color
//     * cell_type 'zak'       → als yard_cells (rij,layer) heeft material → area_type='zak', name=material
//     * cell_type 'wall'/'container-type'/'afval-type' → geen area (los)
//     * cell_type 'zak-num'   → blijft zak-num met label, geen area
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

  // ── 1. Lees legacy data ──
  const layoutRows = (await client.query(
    'SELECT col, row, cell_type, label, meta, updated_at FROM yard_layout'
  )).rows;
  const yardCellsRows = (await client.query(
    'SELECT row_num, layer, type FROM yard_cells WHERE type <> $1',
    ['Empty']
  )).rows;

  console.log(`Legacy: ${layoutRows.length} layout cellen, ${yardCellsRows.length} zak materialen`);

  // Lookup: "rij-layer" → material name
  const zakMat = new Map();
  for (const r of yardCellsRows) {
    zakMat.set(`${r.row_num}-${r.layer}`, r.type);
  }

  // ── 2. Bouw areas en cells in-memory ──
  const areas = new Map(); // key (areaType|name) → { tempId, ...data }
  const cells = [];        // { col, row, area_id, cell_type, label, meta }
  let tempIdCounter = 1;

  function getOrCreateArea(areaType, name, color, materialName) {
    const key = `${areaType}|${name || ''}`;
    let a = areas.get(key);
    if (!a) {
      a = {
        tempId: tempIdCounter++,
        name: name || '',
        area_type: areaType,
        color: color || null,
        material_name: materialName || null,
      };
      areas.set(key, a);
    } else {
      // Bestaande area: update material_name als ontbreekt
      if (materialName && !a.material_name) a.material_name = materialName;
      if (color && !a.color) a.color = color;
    }
    return a;
  }

  for (const row of layoutRows) {
    const ct = row.cell_type || '';
    const label = row.label || '';
    const meta = row.meta || {};

    let newCellType = 'empty';
    let newLabel = label;
    let areaId = null;

    if (ct === 'wall') {
      newCellType = 'wall';
    } else if (ct === 'container-type') {
      newCellType = 'container';
      newLabel = label || 'Container';
    } else if (ct === 'afval-type') {
      newCellType = 'afval';
      newLabel = label || 'Afval';
    } else if (ct === 'zak-num') {
      newCellType = 'zak-num';
      newLabel = label;
    } else if (ct === 'zak') {
      newCellType = 'zak';
      const rij = meta.rij;
      const layer = meta.layer;
      const mat = (rij != null && layer != null) ? zakMat.get(`${rij}-${layer}`) : null;
      if (mat) {
        const a = getOrCreateArea('zak', mat, null, mat);
        areaId = a.tempId;
      }
      newLabel = '';
    } else if (ct === 'bunker-type' || ct === 'bunker-filled') {
      newCellType = 'bunker';
      const a = getOrCreateArea('bunker', label || `Bunker ${row.col}-${row.row}`, '#e67e22', null);
      areaId = a.tempId;
      newLabel = '';
    } else if (ct.startsWith('custom-')) {
      newCellType = 'custom';
      const color = meta.color || null;
      const a = getOrCreateArea('custom', label || ct, color, null);
      areaId = a.tempId;
      newLabel = '';
    } else {
      console.warn(`Onbekend cell_type "${ct}" — overslaan (col=${row.col} row=${row.row})`);
      continue;
    }

    cells.push({
      col: row.col,
      row: row.row,
      area_id: areaId,
      cell_type: newCellType,
      label: newLabel,
      meta: meta,
      updated_at: row.updated_at || Date.now(),
    });
  }

  console.log(`Gepland: ${areas.size} areas, ${cells.length} cellen`);

  // ── 3. Wis huidige cells/areas (schone import) ──
  await client.query('BEGIN');
  await client.query('DELETE FROM cells');
  await client.query('DELETE FROM areas');

  // ── 4. Insert areas, krijg echte IDs ──
  const idMap = new Map(); // tempId → real id
  for (const a of areas.values()) {
    const r = await client.query(
      `INSERT INTO areas (name, area_type, color, material_name, updated_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [a.name, a.area_type, a.color, a.material_name, Date.now()]
    );
    idMap.set(a.tempId, r.rows[0].id);
  }
  console.log(`✓ ${areas.size} areas geïnserteerd`);

  // ── 5. Insert cells in batches van 200 ──
  const batchSize = 200;
  for (let i = 0; i < cells.length; i += batchSize) {
    const batch = cells.slice(i, i + batchSize);
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
  console.log(`✓ ${cells.length} cellen geïnserteerd`);

  await client.query('COMMIT');
  await client.end();
  console.log('\nImport voltooid.');
}

run().catch(async (err) => {
  console.error('Import gefaald:', err);
  process.exit(1);
});
