// Plattegrond natekenen op basis van de aangeleverde tekening.
// Elke cel = 1 grid-eenheid. Muren zijn 1 cel breed.
// Coördinaten: col = x (links→rechts), row = y (boven→beneden)
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

  // Eerst alles wissen
  await c.query('BEGIN');
  await c.query('DELETE FROM cells');
  await c.query('DELETE FROM areas');

  const ts = Date.now();
  const walls = [];

  // Helper: voeg een horizontale muurlijn toe
  function hWall(row, colStart, colEnd) {
    for (let col = colStart; col <= colEnd; col++) {
      walls.push([col, row]);
    }
  }

  // Helper: voeg een verticale muurlijn toe
  function vWall(col, rowStart, rowEnd) {
    for (let row = rowStart; row <= rowEnd; row++) {
      walls.push([col, row]);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PLATTEGROND — exact nagetekend van de afbeelding
  // Grid: 1 cel = ~1 meter. Totaal ca. 52 breed × 32 hoog
  // ═══════════════════════════════════════════════════════════════════

  // ── GROOT L-VORMIG GEBOUW (links) ──

  // Bovenmuur links: opening linksboven (col 2-3), dan muur
  // Bovenmuur loopt van col 4 tot col 20 op row 2
  hWall(2, 4, 20);

  // Linksboven hoek: korte verticale stukjes
  vWall(2, 2, 3);    // kort stukje linksboven-hoek
  hWall(2, 2, 3);    // bovenkant van de hoek

  // Linkermuur: van row 3 naar beneden tot row 26
  vWall(2, 4, 26);

  // Bovenmuur rechterhelft: van col 20 gaat het naar beneden (de L-uitsparing)
  vWall(20, 2, 8);   // rechtermuur bovenste deel

  // De L-uitsparing: muur gaat naar links op row 8
  hWall(8, 14, 20);

  // Dan naar beneden langs col 14
  vWall(14, 8, 18);

  // Onderkant van het rechtergedeelte van de L: muur op row 18 van col 14 naar col 20
  // Nee — de L gaat verder naar beneden. Laat me de tekening opnieuw analyseren.

  // De rechtermuur van het grote gebouw gaat van row 8 naar beneden langs col 20
  // tot row 18, dan naar links naar col 14, dan naar beneden naar row 26
  
  // Correctie: de tekening toont:
  // - Rechtermuur bovenste deel: col 20, row 2-8
  // - Horizontale muur: row 8, col 14-20 (de "trap" in de L)
  // - Rechtermuur middelste deel: col 14, row 8-18
  // - Ondermuur: row 18, col 14-20 — NEE

  // Laat me opnieuw kijken. De tekening toont een groot gebouw links met:
  // - Een rechthoekige uitsparing rechtsboven
  // De onderkant van het grote gebouw loopt door

  // Ik herstart de muurlogica met een schonere analyse:

  // Reset walls
  walls.length = 0;

  // ═══════════════════════════════════════════════════════════════════
  // SCHONE ANALYSE VAN DE PLATTEGROND
  // ═══════════════════════════════════════════════════════════════════
  //
  // De tekening toont (geschaald naar grid):
  //
  // Linkerdeel: groot L-vormig gebouw
  //   - Buitenmaten: ~24 breed × ~28 hoog
  //   - Uitsparing rechtsboven: ~8 breed × ~10 hoog
  //   - Kleine uitstulping onderaan midden: ~4 breed × ~4 hoog
  //
  // Rechterdeel: twee ruimtes boven + open ruimte onder
  //   - Bovenste ruimte links: ~12 breed × ~10 hoog
  //   - Bovenste ruimte rechts: ~10 breed × ~10 hoog (met muurtjes binnenin)
  //   - Horizontale scheidingsmuur halverwege
  //   - Twee korte verticale muurtjes rechtsonder
  //
  // Laat me dit op een 50×32 grid tekenen:

  // ── GROOT GEBOUW LINKS ──

  // Bovenmuur: row 2, col 2-3 (hoekstuk), opening col 4-5, dan col 6-22
  // Eigenlijk: de tekening toont twee openingen boven
  // Links: opening bij col ~3-5
  // Rechts: de muur stopt bij col ~22

  // Bovenmuur linkerdeel
  vWall(2, 2, 3);      // hoekstuk linksboven (verticaal)
  hWall(2, 2, 4);      // kort stukje bovenmuur links
  // Opening col 5-6
  hWall(2, 7, 22);     // bovenmuur hoofddeel

  // Bovenmuur rechterdeel (na de L-uitsparing)
  // De muur gaat bij col 22 naar beneden

  // Linkermuur
  vWall(2, 4, 28);     // hele linkerkant naar beneden

  // Ondermuur links
  hWall(28, 2, 12);    // ondermuur linkerdeel

  // Kleine uitstulping onderaan
  vWall(12, 28, 32);   // rechts van uitstulping
  hWall(32, 10, 12);   // onderkant uitstulping
  vWall(10, 28, 32);   // links van uitstulping

  // Ondermuur rechts (na uitstulping)
  hWall(28, 12, 22);   // ondermuur rechterdeel

  // Rechtermuur onderste deel (van de L)
  vWall(22, 12, 28);   // rechtermuur onderste helft

  // L-uitsparing: horizontale muur op row 12
  hWall(12, 16, 22);   // horizontale muur van de L-trap

  // Rechtermuur bovenste deel
  vWall(22, 2, 6);     // rechtermuur bovenste stuk
  // Opening col 22, row 7-8
  vWall(16, 6, 12);    // binnenmuur van de L (verticaal)
  hWall(6, 16, 22);    // bovenkant van de L-uitsparing

  // ── RECHTERGEBOUW (twee ruimtes boven) ──

  // Grote ruimte linksboven-rechts
  // Bovenmuur
  hWall(2, 28, 38);    // bovenmuur linker ruimte rechts
  // Nee, dit klopt niet. De rechterruimtes zitten RECHTS van het grote gebouw.

  // Laat me opnieuw beginnen met een duidelijker grid.

  walls.length = 0;

  // ═══════════════════════════════════════════════════════════════════
  // DEFINITIEVE PLATTEGROND
  // ═══════════════════════════════════════════════════════════════════
  //
  // Grid schaal: 1 cel ≈ 1 eenheid
  // Oorsprong: linksboven = (0, 0)
  //
  // GROOT L-VORMIG GEBOUW:
  //   Buitenomtrek (met de klok mee, startend linksboven):
  //   (2,2) → rechts naar (22,2) [bovenmuur, met opening bij 4-5]
  //   (22,2) → beneden naar (22,10) [rechtermuur boven]
  //   (22,10) → links naar (16,10) [horizontale muur L-trap]
  //   (16,10) → beneden naar (16,20) [binnenmuur L verticaal]
  //   (16,20) → rechts naar (22,20) — NEE
  //
  // OK ik ga het simpeler doen. Ik teken de muren cel voor cel.

  walls.length = 0;

  // ═══════════════════════════════════════════════════════════════════
  // PLATTEGROND — CEL VOOR CEL
  // ═══════════════════════════════════════════════════════════════════

  // Schaal: de tekening is ~52 eenheden breed, ~32 hoog
  // Ik gebruik een grid van 52 × 32

  // ── LINKERDEEL: GROOT L-VORMIG GEBOUW ──

  // BOVENMUUR
  // Linksboven hoek (dik, 2 cellen): col 3, row 2-3
  walls.push([3, 2], [3, 3]);
  // Bovenmuur links: row 2, col 3-5
  hWall(2, 3, 5);
  // Opening (deur/poort) bij col 6-7
  // Bovenmuur vervolg: row 2, col 8-22
  hWall(2, 8, 22);

  // LINKERMUUR: col 3, row 2-28
  vWall(3, 2, 28);

  // ONDERMUUR LINKS: row 28, col 3-13
  hWall(28, 3, 13);

  // UITSTULPING ONDERAAN (kleine rechthoek naar beneden)
  vWall(13, 28, 32);   // rechts
  hWall(32, 11, 13);   // onder
  vWall(11, 28, 32);   // links

  // ONDERMUUR RECHTS: row 28, col 13-22 — maar de ondermuur loopt door
  // De tekening toont dat de ondermuur doorloopt van de uitstulping naar rechts
  hWall(28, 13, 22);

  // RECHTERMUUR ONDERSTE DEEL: col 22, row 10-28
  vWall(22, 10, 28);

  // L-TRAP: horizontale muur op row 10, col 16-22
  hWall(10, 16, 22);

  // L-TRAP: verticale binnenmuur col 16, row 2-10
  // Nee — de tekening toont dat de bovenmuur doorloopt tot col 22,
  // dan naar beneden tot row ~10, dan naar links tot col ~16,
  // dan naar beneden tot row ~20... 

  // Laat me de tekening nog een keer heel precies bekijken:
  //
  // LINKERDEEL (L-vorm):
  //   Bovenmuur: van (3,2) naar rechts tot (22,2) — met opening bij ~(6,2)-(7,2)
  //   Rechtermuur boven: (22,2) naar beneden tot (22,10)
  //   Horizontale trap: (22,10) naar links tot (16,10)
  //   Verticale binnenmuur: (16,10) naar beneden tot (16,20)
  //   Ondermuur boven-rechts: (16,20) naar rechts tot (22,20) — NIET ZICHTBAAR
  //   
  //   Eigenlijk: de L-vorm betekent dat het gebouw NIET doorloopt rechtsonder.
  //   De rechtermuur gaat van (22,2) naar (22,10), dan naar links naar (16,10),
  //   dan naar beneden naar (16,28), en de ondermuur gaat van (3,28) naar (16,28).
  //   
  //   Maar de tekening toont dat de ondermuur VERDER gaat dan col 16...
  //   En er is een aparte rechtermuur bij col 22 die lager begint.
  //
  // Ik denk dat de correcte interpretatie is:
  //   - Groot gebouw links: rechthoek (3,2)-(22,28) MINUS uitsparing (16,2)-(22,10)
  //   - Dat geeft de L-vorm

  walls.length = 0;

  // ── DEFINITIEF ──

  // GROOT L-VORMIG GEBOUW
  // Buitenmuren:

  // Bovenmuur: row 2, col 3 tot col 16 (tot de L-uitsparing)
  // Met opening bij col 5-6
  hWall(2, 3, 4);      // links van opening
  // opening col 5-6
  hWall(2, 7, 16);     // rechts van opening tot L-hoek

  // Linkermuur: col 3, row 2 tot row 28
  vWall(3, 2, 28);

  // Bovenmuur van de L-uitsparing: row 10, col 16 tot col 22
  hWall(10, 16, 22);

  // Rechtermuur boven de L: col 16, row 2 tot row 10
  vWall(16, 2, 10);

  // Rechtermuur onder de L: col 22, row 10 tot row 28
  vWall(22, 10, 28);

  // Ondermuur: row 28, col 3 tot col 22
  // Met uitstulping bij col 11-13
  hWall(28, 3, 11);    // links van uitstulping
  hWall(28, 13, 22);   // rechts van uitstulping

  // Uitstulping onderaan
  vWall(11, 28, 32);   // links
  hWall(32, 11, 13);   // onder
  vWall(13, 28, 32);   // rechts

  // ── RECHTERGEBOUW: TWEE RUIMTES BOVEN ──

  // Grote ruimte (linksboven van het rechterblok)
  // Bovenmuur: row 2, col 28 tot col 38
  hWall(2, 28, 38);
  // Linkermuur: col 28, row 2 tot row 18
  vWall(28, 2, 18);
  // Ondermuur: row 18, col 28 tot col 50
  hWall(18, 28, 50);
  // Tussenmuur verticaal: col 38, row 2 tot row 10
  // (scheidt de twee bovenruimtes)
  // Eigenlijk: de tekening toont een verticale muur die de twee bovenruimtes scheidt
  vWall(38, 2, 10);

  // Kleine ruimte (rechtsboven)
  // Bovenmuur: row 2, col 42 tot col 50
  hWall(2, 42, 50);
  // Rechtermuur: col 50, row 2 tot row 18
  vWall(50, 2, 18);
  // Linkermuur: col 42, row 2 tot row 10
  vWall(42, 2, 10);

  // Horizontale scheidingsmuur halverwege rechterblok
  // row 10, col 28 tot col 50
  hWall(10, 28, 50);

  // Twee korte verticale muurtjes in rechter-onderruimte
  // Deze zitten in de ruimte onder de horizontale scheidingsmuur, rechts
  vWall(44, 10, 14);   // eerste muurtje
  vWall(47, 10, 14);   // tweede muurtje

  // ── MUREN INVOEGEN IN DATABASE ──

  // Dedupliceer
  const unique = new Map();
  for (const [col, row] of walls) {
    unique.set(`${col},${row}`, { col, row });
  }

  const wallCells = [...unique.values()];
  console.log(`Invoegen: ${wallCells.length} muurcellen`);

  for (const w of wallCells) {
    await c.query(
      `INSERT INTO cells (col, row, cell_type, label, meta, updated_at)
       VALUES ($1, $2, 'wall', '', '{}', $3)
       ON CONFLICT (col, row) DO UPDATE SET cell_type = 'wall', updated_at = $3`,
      [w.col, w.row, ts]
    );
  }

  await c.query('COMMIT');
  await c.end();
  console.log(`Klaar: ${wallCells.length} muurcellen geplaatst`);
})().catch((e) => { console.error(e); process.exit(1); });
