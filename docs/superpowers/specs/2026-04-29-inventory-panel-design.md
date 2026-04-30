# Inventory-paneel (Voorraad) — Design

**Status:** Goedgekeurd voor implementatie
**Datum:** 2026-04-29
**Scope:** Alleen frontend. Read-only view. Geen DB- of API-wijzigingen.

## Doel

In de Overzicht-mode een uitklapbaar zijpaneel rechts dat live toont
hoeveel zakken er per code/materiaal liggen en hoeveel partijen balen
per materiaal. Geen invoer, alleen lezen.

## Layout & interactie

- **Lipje rechts**, verticaal, vast aan de viewport (`position: fixed`,
  ~50% hoogte). Tekst verticaal: "Voorraad". Subtiele schaduw.
- **Klik op lipje → paneel schuift open** vanaf rechts via CSS
  `transform: translateX`. Breedte 320px, full-height.
- **Lipje wordt close-knop** wanneer paneel open is (chevron-icoon
  draait richting kant van paneel).
- **Sluiten** via lipje of klik buiten het paneel.
- **Alleen zichtbaar in Overzicht-mode** (`modeStore === 'view'`). In
  Indeling-mode is het lipje weg — daar zit het EditPanel al rechts.
- **Open/dicht-state** persistent in localStorage. Standaard dicht bij
  eerste bezoek.

## Data-aggregatie

Pure client-side, reactief op `cellsStore` + `areasStore`. Geen API.

### Zakken

```
Voor elke cell met cell_type='zak' EN meta.zakAnchor=true:
  code     = cell.meta.zakCode || '(geen code)'
  material = cell.meta.zakMaterial || null
  → tel +1 op voor (code, material)
```

Resultaat:

```ts
type ZakAggregate = Map<string, {
  total: number;
  byMaterial: Map<string | null, number>;
}>;
```

Codes zonder TL-link (Granulaat Mix, S29, etc.) hebben `material=null`
voor alle zakken en krijgen geen sub-groep — alleen een totaalregel.

### Balen

```
Voor elke area met area_type='bunker' EN material_name gevuld:
  material = area.material_name
  qty      = area.metadata?.quantity || 0
  → som qty bij material, +1 voor aantal areas (intern, niet getoond)
```

Resultaat:

```ts
type BalenAggregate = Map<string, {
  partijen: number;  // som van quantity
  areas:    number;  // intern, voor toekomstige uitbreiding
}>;
```

Wanneer "aantal balen" later aan `metadata` wordt toegevoegd, breiden
we het type uit met een derde veld (`balen`) en tonen we beide.

### Live updaten

Subscribe op `cellsStore` + `areasStore`, aggregatie hercomputen via
Svelte `$derived`. Bij ~6000 zak-cellen is dit een paar milliseconden
— geen debounce of memoisatie nodig.

## Visuele structuur

```
┌──────────────────────────┐
│ Voorraad             ›  │
├──────────────────────────┤
│ ZAKKEN                   │
│   S01            12 zk  │
│     Couliet       7      │
│     Citeofp3      5      │
│   S02             4 zk  │
│     Couliet       4      │
│   T01             8 zk  │
│     Augustine     6      │
│     Pellets       2      │
│   Granulaat Mix   3 zk  │
│                          │
│ BALEN                    │
│   Couliet      18 partijen│
│   Augustine S   4 partijen│
│   Citeofp3      9 partijen│
└──────────────────────────┘
```

- Twee secties: **Zakken** en **Balen**, met sectiekoppen.
- Alleen codes/materialen tonen die daadwerkelijk geplaatst zijn —
  lege types verbergen.
- **Sortering zakken:** in volgorde van `zakCodesStore` (jouw config).
- **Sortering balen:** op `partijen` aflopend (meest aanwezig bovenaan).
- **Sub-materialen bij zakken:** alfabetisch.
- Cijfers in monospace zodat ze rechts uitlijnen.

## Component-structuur

- **Nieuw component:** `frontend/src/lib/components/InventoryPanel.svelte`
  - Bevat lipje + paneel + aggregatielogica.
  - ~200-250 regels, één bestand.
- **Nieuwe store:** `inventoryPanelOpen` in
  `frontend/src/lib/stores/ui.ts`
  - `boolean`, gepersisteerd in localStorage onder
    `yard_inventory_panel_open`.
  - Default `false`.
- **Mount-punt:** in `frontend/src/App.svelte` naast `EditPanel`.
  Alleen renderen wanneer `mode === 'view'`.
- **Aggregatie:** `$derived` op `cellsStore` + `areasStore` via
  `useStore`.

## Edge cases

- **Zak zonder zakCode:** valt onder code `(geen code)` als sentinel.
  Wordt onderaan getoond als die voorkomt.
- **Zak zonder zakMaterial maar wel zakCode met TL-link:** kan
  voorkomen als de TL leeg was bij plaatsing. Telt mee onder de code,
  geen material-regel.
- **Bunker-area zonder material_name:** wordt overgeslagen (geen
  materiaal toegewezen).
- **Bunker-area met material_name maar zonder quantity:** telt mee
  als `partijen += 0`. Toon alleen materialen waar `partijen > 0` óf
  `areas > 0`. We tonen `partijen=0` niet leeg — dan komt zo'n
  materiaal pas in het lijstje na de eerste partij-invoer.

## Buiten scope

- Filteren/zoeken in het paneel.
- Klik op item → highlight op canvas.
- Export.
- Aantal balen (komt later — design houdt daar rekening mee in de
  data-laag).
- Mobile/tablet-specifieke behavior — paneel werkt op tablets via
  hetzelfde mechanisme; full-screen overlay e.d. niet nodig.
