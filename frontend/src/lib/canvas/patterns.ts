// Offscreen-canvas patronen voor cell-fills.
// Gebruikt door YardRenderer voor o.a. wall-cellen (running-bond bakstenen).
//
// LET OP: tile-afmetingen zijn hardcoded op (CELL*2, CELL) met CELL=24.
// Geen import van YardRenderer hier — anders ontstaat een circular import
// (YardRenderer importeert van dit bestand) die runtime een TDZ-error geeft.
const TILE_W = 48; // 2 * CELL
const TILE_H = 24; // 1 * CELL

let wallTile: HTMLCanvasElement | null = null;

export function getWallPattern(): HTMLCanvasElement {
  if (wallTile) return wallTile;

  const c = document.createElement('canvas');
  c.width = TILE_W;
  c.height = TILE_H;
  const ctx = c.getContext('2d')!;

  // mortar/voeg-kleur (donker slate)
  ctx.fillStyle = '#1a252f';
  ctx.fillRect(0, 0, TILE_W, TILE_H);
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(0, 0, TILE_W, TILE_H);

  const brick = (x: number, y: number, w: number, h: number, alpha: number) => {
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(x, y, w, h);
  };

  // ROW A (y=1..11) — twee volle stenen
  brick(1,  1, 22, 10, 0.90);
  brick(25, 1, 22, 10, 0.72);

  // ROW B (y=13..23) — verspringend, halve stenen aan de seam
  brick(0,  13, 11, 10, 0.88);
  brick(13, 13, 22, 10, 0.78);
  brick(37, 13, 11, 10, 0.88);

  wallTile = c;
  console.log('[patterns] wall brick-tile gegenereerd (' + TILE_W + 'x' + TILE_H + ')');
  return c;
}

export const WALL_TILE_W = TILE_W;
export const WALL_TILE_H = TILE_H;
