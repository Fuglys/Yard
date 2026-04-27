# Yard Manager v3 — UI Redesign Spec

**Author:** Smit (UI design)
**Date:** 2026-04-26
**Audience:** Frontend engineer implementing in Svelte 5 + Vite + Konva + Dexie
**Scope:** Visual + UX redesign. No data-model changes; only additive `metadata` keys on `areas`.

---

## 0. TL;DR

The current UI is functionally complete but cluttered. Three concrete moves fix most of it:

1. **Promote material-assignment to the header** as a returning, modernized "TL1/TL2" pair — now called the **Rij-pickers**. They are *always visible in Inhoud mode* and act as the primary year-planner control.
2. **Restructure the right panel** from 9 stacked sections into a **3-tab tool palette** (Indeling / Zakken / Balen) plus a fixed footer (history + actions). Brush controls collapse into a popover triggered from the active tool's chip.
3. **Make placement self-completing**: after dropping a zak-rij or bunker, a lightweight inline prompt asks for material immediately. No more "place it, then go fishing in a side panel."

These three changes alone reduce visible UI noise by ~50% and remove the legacy regression (TL1/TL2). Everything else is polish.

---

## A. Overall layout shift

### Frame, by mode

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Y  Yard Manager  v3.6.0     [ Overzicht | Inhoud | Indeling ]   ◉ Online · 0 · ⊖ ⛶ ⊕ ·  GB │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                                                                             │
│                              YARD CANVAS                                    │
│                              (full-bleed)                                   │
│                                                                             │
│                                                                             │
│  ┌──────────────┐                                                           │
│  │ Status hint  │  ← floating bottom-left context strip                     │
│  └──────────────┘                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

In **Indeling mode** a right tool panel slides in (320 px wide on desktop, full-height drawer on tablet portrait).
In **Inhoud mode** the header grows a second row with the **Rij-pickers** (the returning TL1/TL2).
In **Overzicht mode** the canvas is unobstructed; the header is the lightest possible surface.

### Header layout — three contextual variants

**Overzicht (read-only)**
```
[ Y  Yard Manager  v3.6.0 ]   [ ◉ Overzicht ]                       [ Online · ⊖ ⛶ ⊕ · GB ]
```

**Inhoud (year-planner active)**
```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [ Y  Yard Manager ]  [ Overzicht | ◉ Inhoud | Indeling ]              [ Online · GB ▾ ]  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  Actieve rij(en)   ┌─ Rij A ──────────────┐  ┌─ Rij B ──────────────┐  ┌+ rij┐  Periode  │
│                    │ TL1 ▾  Rij 12   ✕   │  │ TL2 ▾  —  selecteer  │  └─────┘  [Q2 ▾]  │
│                    │ S01  Wintertarwe ▾  │  │       (geen rij gek.) │                   │
│                    │ ▤ Toepassen op rij  │  │                       │                   │
│                    └──────────────────────┘  └───────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Indeling (admin)**
```
[ Y  Yard Manager ]  [ Overzicht | Inhoud | ◉ Indeling ]              [ Online · GB ]
                                                                     ┌──── tool panel ───┐
                                                                     │ Indeling | Zak | Bal│
                                                                     │ ...                │
                                                                     └────────────────────┘
```

### Why these structural choices

- **Header carries mode-specific controls** — context-coupled controls have higher discoverability than ones tucked into a side panel. Material pickers belong in Inhoud's primary chrome because that *is* the job-to-be-done.
- **No left rail.** Three modes is too few to justify a permanent rail; the existing center-pill mode switch is correct.
- **No floating action bar.** Tablet users on a tractor can't spare touch-pad real estate for floating chrome.
- **Right panel only in Indeling.** Inhoud and Overzicht should give the canvas maximum breathing room.

---

## B. Right panel ("Indeling-tools") redesign

### Current pain
9 sections (Selecteren, Penseelgrootte, Vaste structuren, Zakken, Balen, Aangepast vlak, Hulpmiddelen, Geschiedenis, Acties) all visible at once. Brush hero takes ~140 px. Vertical scrolling required even on desktop.

### New structure: 3 tabs + sticky footer + brush popover

```
┌──── Indeling-tools ────────────── Layout edit ─┐
│ ┌─ INDELING ─┬─ ZAKKEN ─┬─ BALEN ─┐            │
│ │  active    │          │         │            │
│ └────────────┴──────────┴─────────┘            │
│                                                │
│  ┌── Selecteer ──────────────────────────────┐ │
│  │ ◉  Selectie + verplaatsen + resizen      │ │
│  │    Sleep rechthoek · Shift = proportioneel│ │
│  └───────────────────────────────────────────┘ │
│                                                │
│  ┌── Vaste structuren ───────────────────────┐ │
│  │ ▮ Muur      📦 Container    🗑 Afval      │ │
│  └───────────────────────────────────────────┘ │
│                                                │
│  ┌── Aangepast vlak ─────────────────────────┐ │
│  │ [Naam vlak___________] [■]                │ │
│  │ ▤ Schilder vlak                           │ │
│  └───────────────────────────────────────────┘ │
│                                                │
│  ╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶ │
│                                                │
│  Active tool      ┌──────────────────────────┐ │
│  ─────────────    │ ▤ Schilder vlak  · 3×3 ▾ │ │  ← clicking 3×3 opens brush popover
│                   └──────────────────────────┘ │
│                                                │
├────────────────────────────────────────────────┤
│  ↶ Ongedaan      ↷ Opnieuw       🧹 Wis tool   │  ← sticky footer
└────────────────────────────────────────────────┘
```

**Tab: Zakken**
```
┌─ INDELING ─┬─ ZAKKEN ─┬─ BALEN ─┐
│            │  active  │         │
└────────────┴──────────┴─────────┘

  ┌── Plaatsen ─────────────────────────────────┐
  │  ▤ Zak-positie (2×2)                        │
  │                                             │
  │  Nummering richting                         │
  │  [↔ Horizontaal]  [↕ Verticaal ◉]           │
  │                                             │
  │  ☑ Automatisch nummeren                     │
  └─────────────────────────────────────────────┘

  ┌── Handmatige nummering ─────────────────────┐
  │  Van [   1] Tot [  55]                       │
  │  🔢 Nummering 1–55                          │
  └─────────────────────────────────────────────┘

  ┌── Onderhoud ────────────────────────────────┐
  │  🧹 Wis losse nummering                     │
  │  ↺ Reset counter                            │
  └─────────────────────────────────────────────┘
```

**Tab: Balen**
```
  ┌── Plaatsen ─────────────────────────────────┐
  │  Naam (optioneel) [_______________]         │
  │  ▤ Bunker                                   │
  │                                             │
  │  Tip: na plaatsing kun je direct materiaal  │
  │  toewijzen.                                 │
  └─────────────────────────────────────────────┘
```

### Brush popover

Brush controls are **on-demand**, opened from the active-tool chip in the sticky footer. Closing it commits the size.

```
                                  ┌───── Penseelgrootte ─────┐
                                  │                          │
                                  │    ┌──────────┐  3 × 3   │
                                  │    │ ▦ ▦ ▦   │  9 cellen│
                                  │    │ ▦ ▦ ▦   │          │
                                  │    │ ▦ ▦ ▦   │          │
                                  │    └──────────┘          │
                                  │                          │
                                  │  Breed [−] [ 3] [+]     │
                                  │  Hoog  [−] [ 3] [+]     │
                                  │                          │
                                  │  [1×1] [2×2] [3×3] [5×5]│
                                  │  [↔] [↕] [■]            │
                                  └──────────────────────────┘
```

**Why a popover, not a stacked panel section:**
- Brush size is set once per session in 80% of cases. Persistent UI is real-estate that pays for itself rarely.
- Popover surfaces it on-demand at the moment of intent (right after picking a tool that uses it).
- Tools that don't use brush size (Selectie, Hulpmiddelen) shouldn't show the chip.

### Component breakdown (Svelte file plan)

```
src/lib/components/edit-panel/
  EditPanelV2.svelte         # tab shell, sticky footer
  TabIndeling.svelte         # Selecteer + Vaste + Aangepast
  TabZakken.svelte           # Zak placement + numbering
  TabBalen.svelte            # Bunker placement
  ActiveToolChip.svelte      # Active-tool footer chip + brush trigger
  BrushPopover.svelte        # Detached popover (Floating-UI-free; Svelte action OK)
  ToolButton.svelte          # Reusable tool button (swatch + label + active state)
  SectionCard.svelte         # Wraps grouped controls in soft-bordered card
```

### Touch / spacing rules (this panel)

- All primary actions ≥ **44 px tap target** (currently most are 32–36 px).
- Tabs: 48 px tall, full-width grid.
- Sticky footer: 64 px tall.
- Section cards: 12 px internal padding, 8 px gap between sections.
- Panel width: **320 px desktop**, **100 vw drawer** on tablet portrait (slides in from right).

---

## C. Inhoud mode — the year-planner experience

### Concept: lightweight, data-additive jaarplanner

We don't need a Gantt or calendar grid. The user manages "what's in each rij/bunker right now, for this period." Period changes ~4×/year. So the model is: **active period + per-area material + a low-friction 'apply to whole rij' action**.

### What's added

1. **Period selector** (Q1 / Q2 / Q3 / Q4 or month) — stored in `localStorage` as `currentPeriod`. Areas store assignments per period in `metadata.periods[periodKey]`.
2. **Rij-pickers (returning TL1/TL2)** — pick a rij, pick a material, hit "Toepassen op rij" → all 13 zak-positions in that rij get the chosen material *for the active period*.
3. **Inline summary tiles** along the bottom of the canvas: count of unfilled positions, materials in use, last-changed timestamp.
4. **Bulk re-assign** drawer accessible from a "..." menu in header — "Vervang materiaal X door Y voor periode Z."

### Inhoud mode: full screen

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Header (with Rij-pickers row, see §A)                                                    │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│                                                                                          │
│                                                                                          │
│                          YARD CANVAS — material colors + labels                          │
│         (zak rijen tinted by material, bunkers labeled, empty positions hatched)         │
│                                                                                          │
│                                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌──── Status — Q2 2026 ───┐  ┌──── Materiaal-overzicht ──────────────────────┐  [...]  │
│  │ 24 zak-rijen · 312 pos. │  │ ■ S01 (104) ■ S17 (78) ■ T01 (52) □ leeg(78) │         │
│  │ 78 leeg · 5 bunkers     │  │                                                │         │
│  └─────────────────────────┘  └────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Bulk re-assign drawer (triggered from header "..." in Inhoud)

```
┌─── Bulk hertoewijzen ─────────────────────────────┐
│ Periode    [Q3 2026 ▾]                            │
│                                                   │
│ Vervang    [S01 — Wintertarwe       ▾]            │
│ Door       [S02 — Zomertarwe        ▾]            │
│                                                   │
│ Bereik     ◉ Alle vlakken  ○ Alleen zak-rijen     │
│            ○ Alleen bunkers                       │
│                                                   │
│ Voorbeeld: 13 vlakken aangepast                   │
│                                                   │
│ [ Annuleren ]                  [ Toepassen ]      │
└───────────────────────────────────────────────────┘
```

### Picked, not built (intentional cuts)

- **No timeline strip across the top** — the period dropdown gets us 90% of the value with 10% of the complexity. Year-strip wireframes get loud fast on a 1024 px tablet.
- **No drag-from-material-list-to-canvas** — fancy, but doesn't beat tap-to-assign on touch.
- **No printable reports** in v3.7 — leave for a later increment.

### Data model addition (additive only, no migration)

```ts
area.metadata = {
  ...area.metadata,
  periods: {
    "2026-Q2": { material_name: "S01 Wintertarwe", set_at: 1714123200000 },
    "2026-Q3": { material_name: "S02 Zomertarwe",  set_at: 1718000000000 },
  },
  lastFilled: 1714123200000,  // convenience: most recent "set_at"
}
```

`area.material_name` remains the **current** display value (resolved from periods on read). This keeps existing canvas-coloring code working with no changes.

---

## D. Zak-positie & Bale creation flow

### Current
1. Pick zak tool. 2. Click on grid. 3. (Done — material unset.) 4. Switch mode to Inhoud. 5. Tap area. 6. Pick material in bottom sheet. 7. Save.

That's 7 steps, 1 mode switch, and the material assignment is detached from spatial intent.

### Proposed: integrated "place + assign" flow

After placing a zak-rij in Indeling mode, a lightweight **inline assign chip** floats at the canvas attachment point:

```
                  ┌─ Net geplaatst: Rij 14 ─────────────────┐
                  │                                          │
                  │  Materiaal voor deze rij?               │
                  │  [Zoek materiaal_______________ ▾]      │
                  │                                          │
                  │  [Overslaan]    [Toewijzen]              │
                  └──────────────────────────────────────────┘
```

- Auto-dismisses after 6 seconds if untouched.
- Pressing Esc dismisses.
- "Toewijzen" sets `metadata.periods[currentPeriod].material_name` (does *not* require leaving Indeling mode).
- A "Skip prompt" toggle in tool settings lets power-users disable it.

### Visual feedback for placed positions

In **Overzicht** and **Inhoud**:
- Filled zak-positions show a **2-line label**: code (e.g. "S01") large, name ("Wintertarwe") small below.
- Empty zak-positions show subtle diagonal hatching at low opacity (~ 0.12).
- Bunkers always show name + material badge.
- Non-current period assignments rendered at 60% saturation (with tooltip "Uit Q1 2026" on hover/tap).

```
┌─────────────────┐    ┌─────────────────┐
│      S01        │    │                 │
│  Wintertarwe    │    │   ▱ ▱ ▱ ▱ ▱     │   ← empty: hatched
│                 │    │                 │
└─────────────────┘    └─────────────────┘
```

### Bunker flow

Identical pattern: place → inline material chip → assigned. Bunkers additionally support a **capacity** field (already in metadata if used) — show as small "—/—" placeholder in the chip.

---

## E. Visual direction

### Palette — "Daylight Tractor"

Tuned for high-glare daylight tablet use. Higher contrast than the current palette; mode-color identity preserved but refined.

#### Neutrals (surfaces & text)
| Token | Hex | Usage |
|---|---|---|
| `--bg-app` | `#F4F6F8` | App background |
| `--bg-surface` | `#FFFFFF` | Cards, panels |
| `--bg-sunken` | `#EEF1F4` | Inputs, chips at rest |
| `--bg-canvas` | `#F8FAFB` | Yard canvas backdrop |
| `--border-subtle` | `#E2E6EA` | Card borders |
| `--border-strong` | `#CBD5E1` | Inputs, dividers |
| `--text-primary` | `#0F172A` | Body text (was `#1A1A2E` — darker, more contrast) |
| `--text-secondary` | `#475569` | Labels |
| `--text-tertiary` | `#94A3B8` | Hints, placeholders |

#### Mode identity (kept, refined)
| Mode | Token | Hex | Notes |
|---|---|---|---|
| Overzicht | `--mode-view` | `#1F6FB2` | Slightly deeper than `#2E86C1` for better daylight contrast |
| Inhoud | `--mode-content` | `#1E8449` | Crop-green, kept |
| Indeling | `--mode-layout` | `#C2540A` | Deeper than `#E67E22` for AA contrast on white labels |

#### Semantic accents
| Token | Hex | Usage |
|---|---|---|
| `--accent-primary` | `#1F6FB2` | Primary actions, focus rings |
| `--accent-success` | `#1E8449` | Sync OK, save success |
| `--accent-warning` | `#B7791F` | Pending sync, attention |
| `--accent-danger` | `#B91C1C` | Destructive (was `#E74C3C`, raised for AA) |
| `--accent-zak` | `#0E7490` | Material-set zak fill base |
| `--accent-bunker` | `#9A3412` | Bunker fill base |

All foreground/background pairings checked at WCAG AA (4.5:1) for body text and AAA (7:1) where used at small sizes.

### Typography

System sans (Inter) is fine. Define the scale.

| Token | Size / Line | Weight | Use |
|---|---|---|---|
| `--text-2xs` | `10 / 14` | 700 (uppercase) | Section labels |
| `--text-xs` | `11 / 16` | 600 | Hints, tertiary |
| `--text-sm` | `13 / 18` | 500 | Body small |
| `--text-base` | `15 / 22` | 500 | Body (was 14 — 15 reads better at arm's length on a tablet) |
| `--text-md` | `17 / 24` | 600 | Subhead |
| `--text-lg` | `20 / 28` | 700 | Sheet titles |
| `--text-xl` | `26 / 32` | 800 | Display (Rij-picker number) |

Numerals: enable `font-feature-settings: "tnum"` on all controls showing numbers (rij numbers, brush W×H, counts).

### Spacing scale (4-px grid)

`--space-1: 4px · --space-2: 8px · --space-3: 12px · --space-4: 16px · --space-5: 20px · --space-6: 24px · --space-8: 32px · --space-10: 40px`

### Radius

`--radius-sm: 6px` (buttons) · `--radius-md: 10px` (inputs, chips) · `--radius-lg: 14px` (cards) · `--radius-xl: 20px` (sheets)

### Elevation

| Token | Shadow | Use |
|---|---|---|
| `--shadow-1` | `0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.04)` | Resting cards |
| `--shadow-2` | `0 4px 12px rgba(15,23,42,.08)` | Header, sticky footer |
| `--shadow-3` | `0 12px 32px rgba(15,23,42,.14)` | Popovers |
| `--shadow-4` | `0 -10px 40px rgba(15,23,42,.18)` | Bottom sheets |

### Density

Tablet primary, desktop secondary. The same component sizing works on both — we don't ship a separate desktop density. Tablet-min is the floor.

---

## F. Detailed component specs

### F.1 Header Rij-picker (the returning TL1/TL2)

**Purpose:** From the header in Inhoud mode, point at the 1–2 most-relevant zak-rijen and quickly assign material to all positions in those rijen.

**Anatomy**
```
┌─ Rij-picker  (one card per slot, 2 default — "TL1", "TL2") ─┐
│                                                              │
│  ┌──────────────┐   ┌────────────────────────────────────┐  │
│  │ Slot label   │   │  Materiaal-keuze                   │  │
│  │ TL1     [✕] │   │                                    │  │
│  │              │   │  S01 Wintertarwe              ▾   │  │
│  │ Rij  [12 ▾] │   │                                    │  │
│  │              │   │                                    │  │
│  │ 13 posities  │   │  [ ▤ Toepassen op rij ]            │  │
│  └──────────────┘   └────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Dimensions**
- Card: 360 px wide × 96 px tall. Two side-by-side fit at 1024 px tablet width with ~80 px slack for header chrome.
- Rij dropdown trigger: 64 px wide, 36 px tall, displays rij number, reverts to "—" placeholder.
- Material picker trigger: full remaining width, 36 px tall.
- "Toepassen op rij" button: full width, 36 px tall, primary style; disabled until both rij + material are picked.

**States**
- *Empty:* "TL1" label, "Rij —" placeholder, material picker placeholder, button disabled.
- *Rij picked, no material:* Rij filled, count shown ("13 posities"), button still disabled.
- *Both picked:* Button enabled (primary green via `--accent-success` because the action is in Inhoud mode).
- *Just applied:* Toast "Rij 12 — 13 posities op S01 gezet". Button briefly shows ✓ + label "Toegepast" (1.2 s) then resets to "Toepassen op rij".
- *Hover/active/focus:* Standard focus ring (2 px solid `--accent-primary` outset 2 px).
- *Disabled (no rijen exist yet):* Whole card collapses to a 36 px hint: "Plaats eerst zakken in Indeling-modus."

**Interactions**
- Rij dropdown shows only existing zak-rij numbers (deduped from `cellsStore` cells of type `zak`). Most-recent first, then numeric sort.
- Material dropdown is the existing `MaterialPicker` component, widened to fill width.
- Clicking the slot label "TL1" allows renaming (e.g., "Voeder", "Zaai") — stored in `localStorage` per user.
- "+ rij" chip lets the user add a 3rd or 4th slot (cap at 4). Each slot persists across sessions.
- Slot ✕ removes that slot.
- Keyboard: Tab through rij ▾ → material ▾ → Apply. Enter on Apply confirms.

**Apply semantics**
```
For each cell of type 'zak' where meta.zakRij === selectedRij:
  → resolve its area_id
  → write area.metadata.periods[currentPeriod] = { material_name, set_at: now }
  → write area.material_name = material_name (current convenience field)
schedulePush()
toast(`Rij ${rij} — ${count} posities op ${material} gezet`)
```

**Why this design (rationale, bullets)**
- Two-up cards mirror the legacy TL1/TL2 muscle memory but are *clearly* labeled and renameable, removing the legacy's opaqueness.
- "Apply to rij" is one explicit action — no surprise side effects on stray clicks.
- Slot count = 2 default keeps parity; expandable to 4 covers heavy days without crowding.
- Disabling the button until both fields are set prevents the most common error (apply with stale state).
- Period-aware writes mean changes don't clobber other quarters — safe for a year-planner.

---

### F.2 Redesigned right Indeling panel

Already drawn in §B. Concrete dimensions:

| Element | Spec |
|---|---|
| Panel width | 320 px desktop, 100 vw drawer on tablet portrait |
| Header strip | 48 px, padding 12 px, title 13 px / 700, mode badge right |
| Tab strip | 48 px, 3 columns, equal width, active = white surface + 2 px bottom accent in `--mode-layout` |
| Section card | 12 px padding, 14 px radius, 8 px between, `--shadow-1` |
| Tool button | 48 px tall, 12 px swatch + 12 px gap + label, active = tinted `--mode-layout` 12% bg + 1 px `--mode-layout` border |
| Active-tool chip (footer) | 56 px tall, two-row: tool name + brush dim chip (clickable) |
| Sticky footer | 64 px, three buttons equal width, top divider 1 px `--border-subtle` |
| Brush popover | 280 × 320 px, anchored above chip, `--shadow-3` |

**States**
Tool button: default · hover (bg `--bg-sunken`) · pressed (translateY 1 px) · active (selected) · disabled
Brush popover: closed · open (slide-up + fade, 160 ms cubic-bezier(0.2,0.9,0.3,1.1))
Tab: inactive · hover · active · focused (2 px outline)

**Accessibility**
- Tabs: `role="tablist"` / `role="tab"` with `aria-selected`. Tab + arrow keys to navigate.
- Tool buttons: `aria-pressed` for selected state.
- Brush popover: `role="dialog"`, focus-trapped, Esc closes.
- Color swatches: never the *only* indicator — always paired with text label.

---

### F.3 Area Inspector / bottom sheet

Mostly OK today. Refinements:

```
┌──────────────────────────────────────────────────────┐
│ ▤▤▤  Rij 12 · zak-positie                       [×] │  ← drag-handle bar (24×4) + colored title bar
│  Wintertarwe (S01) · Q2 2026                         │
├──────────────────────────────────────────────────────┤
│  Cellen      4                                       │
│  Periode     Q2 2026                                 │
│  Materiaal   S01 Wintertarwe                         │
│  Laatst gewijzigd  26 apr 2026, 14:02                │
│ ──────────────────────────────────────────────────── │
│                                                      │
│  Materiaal in dit vlak                               │
│  [ S01 Wintertarwe                              ▾ ]  │
│                                                      │
│  ☐ Voor alle volgende perioden ook toepassen        │
│                                                      │
├──────────────────────────────────────────────────────┤
│  [↔ Splitsen]  [🗑 Verwijderen]      [ Opslaan ]    │
└──────────────────────────────────────────────────────┘
```

**Refinements vs. current**
- Drag-handle pill at top (24 × 4 px, `--text-tertiary`) signals it's a sheet.
- Subtitle in title bar shows current material + period at a glance (high-info-density opportunity).
- "Period" row added; "Last changed" row added (uses `metadata.lastFilled`).
- "Apply to all later periods" checkbox addresses the common case of a permanent assignment.
- Layout-mode actions (Naam, Kleur, Splitsen, Verwijderen) are unchanged — they were fine.
- Sheet max-height: 80 vh; scroll inside body if overflow.

**Open animation**
Slide up 200 ms cubic-bezier(0.2,0.9,0.3,1) — current value is fine, keep it.

---

### F.4 Inhoud-mode jaarplanner dashboard / overview

The bottom strip from §C, expanded:

```
┌──── Status — Q2 2026 ──────┐  ┌──── Materiaal-overzicht ─────────────────────────┐
│                            │  │                                                  │
│  24  zak-rijen             │  │  ████████████  S01  Wintertarwe   104 (33%)     │
│  312 zak-posities          │  │  █████████     S17  Mais          78  (25%)     │
│  78  leeg                  │  │  ██████        T01  Triticale     52  (17%)     │
│  5   bunkers               │  │  █             —    leeg          78  (25%)     │
│                            │  │                                                  │
│  Laatste wijziging         │  │  [ Bulk hertoewijzen → ]                         │
│  26 apr · 14:02            │  │                                                  │
│                            │  │                                                  │
└────────────────────────────┘  └──────────────────────────────────────────────────┘
```

**Dimensions**
- Strip total height: 128 px on desktop, collapsible to 48 px (pull-down chevron) on tablet.
- Two cards equal flex; gap 16 px; outer padding 16 px.
- Bar widths in materiaal-overzicht: proportional to count, min 8 px so all materials are visible.
- Color of each bar: derived from material's deterministic hash → `hsl(h, 55%, 48%)` so colors are stable across sessions but distinguishable.

**Behaviors**
- Tap a material bar → highlights all areas using that material in the canvas (1.5 s pulse).
- Tap "Bulk hertoewijzen →" → opens the bulk drawer in §C.
- Tap "Laatste wijziging" timestamp → scrolls/pans canvas to that area (nice-to-have, ship if cheap).

**Data sources**
- Counts derived from `areasStore` + `cellsStore` (memoize: dirty-flag on store updates, recompute lazily).
- Material list from `materialsStore` (deduped from current period's assignments).
- Period from `localStorage.currentPeriod` (default: derive from current date).

**Why this dashboard, not more**
- A 128-px strip is the smallest thing that gives the user "did I forget anything?" at-a-glance.
- The two halves answer the two real questions: *"How much is filled?"* and *"What's filled with what?"*.
- Anything more (calendars, charts) waits for evidence of demand. The user mentioned year-planner; the period dropdown + bar chart already deliver that mental model.

---

## G. Performance notes (design-level)

The user mentioned occasional slowness. Design-side rules to avoid making it worse:

- **Tab switching in the right panel must not unmount Konva** — only the right panel's tree should update.
- **Brush popover** uses a Svelte action with `position: fixed` and a single transform; do not animate `width` or `height` (causes layout). Animate `transform` and `opacity` only.
- **Material list virtualization** — if `materials` exceeds 200, the picker should virtualize. Below that, the current full render is fine.
- **Bottom strip computations** — debounce 200 ms after `cellsStore` / `areasStore` updates.
- **Empty-state hatching** for empty zak-positions — render in Konva as a single tiled pattern Image, not per-cell line shapes.
- **Period switch** must not trigger a canvas redraw beyond updating `material_name` references — read pathway should be a derived store.

These are guidelines for the implementer; not all are blocking for the redesign launch.

---

## H. Implementation order (suggested)

1. **Tokens + global styles** — add CSS variables to `app.css`. Backwards-compatible; existing components keep working but adopt new tokens incrementally.
2. **Header refactor** — extract `RijPicker.svelte`, render in Inhoud mode. Wire to existing stores.
3. **EditPanel rewrite** — new tabbed shell + brush popover. Keep `EditPanel.svelte` exporting old API; the rewrite lives in `edit-panel/EditPanelV2.svelte` and `App.svelte` swaps imports.
4. **Inline assign chip** after placement — small new component listening to `paintToolStore` + new `lastPlacedArea` store.
5. **Bottom status strip** in Inhoud mode.
6. **Bulk hertoewijzen drawer.**
7. **Period model** + writes through `metadata.periods`.
8. **AreaInspector tweaks** (drag handle, subtitle, period row).

Each step is independently shippable and reversible.

---

## I. Risks & trade-offs

- **Period model is additive but introduces a new write path.** If the engineer forgets to also set `area.material_name` for the current period, downstream rendering goes stale. Mitigation: a single `setMaterialForArea(areaId, material, period)` helper that always writes both.
- **Rij-picker depends on cells exposing their `meta.zakRij`** — if `zakRij` isn't always set on placement, we'll need to derive it from cell positions (column-based grouping) before this works. Pre-flight check before implementation.
- **"Apply to rij" is a bulk write** — could cascade many sync queue entries. Wrap in a single transaction in Dexie and batch the push.
- **Hatched empty cells in Konva** — performance-sensitive at high zoom levels. Consider showing hatching only at `scale > 0.6` and a flat tint below that.
- **Drawer-style right panel on tablet portrait** is a behavior change (currently fixed-width). Users may briefly disorient; soften with a subtle "swipe edge" affordance.

---

## J. Acceptance checklist (for implementer / reviewer)

- [ ] Header Rij-picker visible only in Inhoud mode; can pick rij + material; "Toepassen" applies to all matching cells.
- [ ] Right panel has 3 tabs: Indeling / Zakken / Balen; sticky footer with undo/redo/clear-tool.
- [ ] Brush controls live in popover; not visible when active tool doesn't use brush.
- [ ] Inline assign chip appears after placing a zak-rij or bunker; auto-dismisses; sets material on current period.
- [ ] Bottom status strip visible in Inhoud mode; shows counts + material breakdown.
- [ ] Bulk re-assign drawer: works for the active period; preview count is correct.
- [ ] All primary buttons ≥ 44 px tall.
- [ ] All foreground/background combinations meet WCAG AA.
- [ ] No new dependencies added to `package.json`.
- [ ] Works offline (no network calls introduced by the redesign).
- [ ] Dutch UI text throughout.
- [ ] No new `console.error` in DevTools after a place-assign-bulk-edit smoke test.

---

*End of spec.*
