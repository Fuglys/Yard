// Migratie: merge gefragmenteerde bunker-areas.
// Bunker-cellen die 4-connected aaneengesloten zijn, krijgen dezelfde area_id.
// Overbodige lege areas worden opgeruimd.
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
  console.log('Connected. Merging fragmented bunker areas...');

  // Haal alle bunker-cellen op
  const { rows: bunkers } = await client.query(
    `SELECT col, row, area_id FROM cells WHERE cell_type = 'bunker' AND deleted_at IS NULL ORDER BY col, row`
  );
  console.log(`Found ${bunkers.length} bunker cells`);

  // Bouw een set voor snelle lookup
  const cellMap = new Map();
  for (const b of bunkers) {
    cellMap.set(`${b.col},${b.row}`, b);
  }

  // Flood-fill om connected components te vinden
  const visited = new Set();
  const components = [];
  for (const b of bunkers) {
    const k = `${b.col},${b.row}`;
    if (visited.has(k)) continue;
    const comp = [];
    const queue = [k];
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      const cell = cellMap.get(cur);
      if (!cell) continue;
      comp.push(cell);
      const [c, r] = cur.split(',').map(Number);
      for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nk = `${c+dc},${r+dr}`;
        if (cellMap.has(nk) && !visited.has(nk)) queue.push(nk);
      }
    }
    components.push(comp);
  }
  console.log(`Found ${components.length} connected components`);

  const ts = Date.now();
  let totalUpdated = 0;
  let areasCreated = 0;

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    // Verzamel bestaande area_ids in deze component
    const areaCounts = new Map();
    for (const c of comp) {
      if (c.area_id != null) {
        areaCounts.set(c.area_id, (areaCounts.get(c.area_id) || 0) + 1);
      }
    }

    let targetAreaId;
    if (areaCounts.size === 0) {
      // Geen area — maak een nieuwe aan
      const { rows } = await client.query(
        `INSERT INTO areas (name, area_type, color, metadata, updated_at)
         VALUES ($1, 'bunker', '#9A3412', '{}', $2) RETURNING id`,
        [`Bunker ${i + 1}`, ts]
      );
      targetAreaId = rows[0].id;
      areasCreated++;
    } else {
      // Kies de area met de meeste cellen
      let max = 0;
      for (const [aid, cnt] of areaCounts) {
        if (cnt > max) { max = cnt; targetAreaId = aid; }
      }
    }

    // Update alle cellen in deze component naar de target area
    const toUpdate = comp.filter(c => c.area_id !== targetAreaId);
    if (toUpdate.length > 0) {
      // Batch update per 500 cellen
      for (let j = 0; j < toUpdate.length; j += 500) {
        const batch = toUpdate.slice(j, j + 500);
        const conditions = batch.map((c, idx) => `(col = $${idx*2+1} AND row = $${idx*2+2})`).join(' OR ');
        const params = batch.flatMap(c => [c.col, c.row]);
        await client.query(
          `UPDATE cells SET area_id = ${targetAreaId}, updated_at = ${ts} WHERE (${conditions})`,
          params
        );
      }
      totalUpdated += toUpdate.length;
    }

    // Verwijder lege areas die niet meer gebruikt worden
    for (const oldId of areaCounts.keys()) {
      if (oldId === targetAreaId) continue;
      const { rowCount } = await client.query(
        `SELECT 1 FROM cells WHERE area_id = $1 AND deleted_at IS NULL LIMIT 1`, [oldId]
      );
      if (rowCount === 0) {
        await client.query(
          `UPDATE areas SET deleted_at = $1, updated_at = $1 WHERE id = $2`, [ts, oldId]
        );
      }
    }
  }

  console.log(`Updated ${totalUpdated} cells, created ${areasCreated} new areas`);
  console.log('Done.');
  await client.end();
}

run().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
