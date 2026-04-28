// Kleurenpalet voor cell types & areas.
export const TYPE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  empty:     { fill: 'transparent',     stroke: '#e2e6ea', text: '#94a3b8' },
  wall:      { fill: '#2c3e50',         stroke: '#1a252f', text: '#fff'    },
  container: { fill: '#7f8c8d',         stroke: '#566573', text: '#fff'    },
  afval:     { fill: '#95a5a6',         stroke: '#7f8c8d', text: '#fff'    },
  bunker:    { fill: '#e67e22',         stroke: '#a04000', text: '#fff'    },
  zak:       { fill: '#ecf0f1',         stroke: '#d5dbdb', text: '#7f8c8d' },
  'zak-num': { fill: '#d6dbdf',         stroke: '#bdc3c7', text: '#2c3e50' },
  custom:    { fill: '#5dade2',         stroke: '#2e86c1', text: '#fff'    },
};

// Materiaal-specifieke kleuren (overrules wanneer area heeft material_name)
export const MATERIAL_COLORS: Record<string, string> = {
  TL1: '#2980b9', TL2: '#27ae60', TL3: '#8e44ad',
  S01: '#a8c8e0', S02: '#6a9bbd', S03: '#4a7a9b', S17: '#3d6f8e',
  T01: '#dba8a8', T02: '#b06868', T17: '#7a3c3c',
  Pellets: '#e0d5a0', DVRMI050: '#d4b896', DVRNA050: '#96c8aa',
  LUMPS: '#9cc0d4', Quarantine: '#a888b5',
};

// Per-zak-code subtiele tinten — elke S/T/Granulaat-code krijgt een eigen
// schakering binnen z'n familie zodat S01 vs S17 niet identiek lijken.
// Lichte HSL-variaties: S* in blauw-spectrum, T* in rood, Granulaat in khaki.
export const ZAK_CODE_COLORS: Record<string, string> = {
  S01: '#bcd6e8',  // licht-blauw 1
  S02: '#a8c8e0',  // licht-blauw 2
  S03: '#94bcd9',  // licht-blauw 3
  S17: '#80b0d2',  // licht-blauw 4 (donkerder)
  S29:  '#bcc4cc', // grijs-blauw 1 (los, geen TL)
  S29A: '#cdd5dc', // grijs-blauw 2 (los, geen TL)
  T01: '#e8c0c0',  // licht-rood 1
  T02: '#dba8a8',  // licht-rood 2
  T03: '#d49696',  // licht-rood 3
  T17: '#cd8484',  // licht-rood 4 (donkerder)
  'Granulaat Mix':     '#c8b88a',  // khaki, donkerder
  'Granulaat Naturel': '#e0d5a0',  // khaki, lichter
};

export function colorForZakCode(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  if (ZAK_CODE_COLORS[code]) return ZAK_CODE_COLORS[code];
  // Custom-naam (vrij ingevuld) → genereer een pasteltint op basis van de naam.
  return hashColor(code);
}

export function colorFor(cellType: string, label?: string, materialName?: string, customColor?: string): { fill: string; stroke: string; text: string } {
  if (customColor) {
    return { fill: customColor, stroke: shade(customColor, -15), text: contrastText(customColor) };
  }
  if (materialName) {
    if (MATERIAL_COLORS[materialName]) {
      const f = MATERIAL_COLORS[materialName];
      return { fill: f, stroke: shade(f, -15), text: contrastText(f) };
    }
    // Materiaal zonder vaste kleur → genereer een kleur op basis van de naam
    const f = hashColor(materialName);
    return { fill: f, stroke: shade(f, -15), text: contrastText(f) };
  }
  if (label && MATERIAL_COLORS[label]) {
    const f = MATERIAL_COLORS[label];
    return { fill: f, stroke: shade(f, -15), text: contrastText(f) };
  }
  return TYPE_COLORS[cellType] || TYPE_COLORS.custom;
}

export function shade(hex: string, percent: number): string {
  if (!hex.startsWith('#')) return hex;
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) + Math.round((percent / 100) * 255);
  let g = ((num >> 8) & 0xff) + Math.round((percent / 100) * 255);
  let b = (num & 0xff) + Math.round((percent / 100) * 255);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function contrastText(hex: string): string {
  if (!hex.startsWith('#')) return '#fff';
  const num = parseInt(hex.slice(1), 16);
  const r = num >> 16, g = (num >> 8) & 0xff, b = num & 0xff;
  // YIQ
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? '#1a1a2e' : '#fff';
}

// Hash naar pleasant pastel (returns hex)
export function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  // HSL to hex: s=55%, l=55%
  const s = 0.55, l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
