# Repository Discovery — Woodaakar Nesting Studio
**Date:** 2026-09-15  
**Baseline:** `sparrow-studio-baseline` (66800ee) — confirmed resolves  
**Git status:** Clean, except two untracked .md files (MULTI_SHEET_SPEC_v3.md, WOODAAKAR_NESTING_EDR_v1.md)

---

## 1. Saved-project schema

### IndexedDB storage
**Database:** `sparrow-project`  
**Store:** `recovery`  
**Key:** `'latest'` (string literal)  
**Implementation:** `web/src/storage/recovery.ts`

### TypeScript interface
**File:** `web/src/model.ts:18`

```typescript
export type Project = Document & { 
  schemaVersion: 1; 
  revision: number; 
  result?: Result 
};

export type Document = { 
  name: string; 
  parts: Part[]; 
  settings: Settings; 
  placements?: Placement[] 
};

export type Settings = { 
  solverPreset?: 'standard' | 'fast'; 
  materialWidthMm: number;      // ← The strip width, stored here
  clearanceMm: number; 
  timeLimitSeconds: 10 | 30 | 60 | 120 | 300 | 600 | null 
};

export type Part = {
  id: string; 
  name: string;
  source: { format: 'svg' | 'dxf' | 'sparrow' | 'drawn'; fileName?: string; entityId?: string };
  outer: Ring;                   // Ring = Point[] where Point = [number, number]
  holes: Ring[]; 
  approximationToleranceMm: number; 
  quantity: number;
  rotations: RotationRule;       // { kind: 'discrete'; degrees: number[] } | { kind: 'continuous' }
  preparationPosition: Point;
};

export type Result = { 
  documentRevision: number; 
  solverRevision: string;        // git SHA
  seed: string; 
  elapsedSeconds: number; 
  usedLengthMm: number;          // ← SPP result field: final strip length
  placements: Placement[];       // per-part x/y/angle
  validation: Validation 
};
```

### What is persisted
- **`schemaVersion: 1`** — always 1 in current code
- **`revision`** — incremented on each document change
- **`name`**, **`parts`**, **`settings`** — full document state
- **`placements`** — optional explicit copy positions (used during interactive editing)
- **`result`** — optional: the last checked solver result with its provenance (seed, revision, runtime, validation badge)

**Storage:** `web/src/storage/recovery.ts:23` — `saveRecovery(project: Project)` writes to `'latest'` key; `readRecovery()` reads it.

---

## 2. Exported ZIP/JSON schema

### Export function
**File:** `web/src/export/zip.ts:18`

```typescript
export function exportProjectArchive(document: Document, revision: number, result?: Result): Uint8Array
```

### ZIP contents
A project download produces a ZIP with:

| File | Content | Conditional |
|------|---------|-------------|
| `project.sparrow-project.json` | Full Project as JSON (schemaVersion:1, revision, document, result) | Always |
| `cli.json` | Sparrow ExtSPInstance format (see §3) | Only if `document.parts.some(part => part.quantity > 0)` |
| `layout.svg` | SVG export of the checked result | Only if `result` exists |
| `layout.dxf` | DXF export of the checked result | Only if `result` exists |
| `README.txt` | Archive format explanation | Always |

**ZIP limit:** 25 MiB (enforced at `zip.ts:29`)  
**Project JSON limit:** 10 MiB (enforced at `import/project.ts:43`)

### Exported Project JSON schema
The `.sparrow-project.json` file matches the in-memory `Project` interface exactly:
```json
{
  "schemaVersion": 1,
  "revision": 42,
  "name": "Workshop parts",
  "parts": [ /* Part[] */ ],
  "settings": { 
    "materialWidthMm": 1000, 
    "clearanceMm": 3, 
    "timeLimitSeconds": null 
  },
  "placements": [ /* optional Placement[] */ ],
  "result": { /* optional Result */ }
}
```

**Import validation:** `web/src/import/project.ts:7–30` — checks schemaVersion === 1, validates geometry, re-verifies the stored result badge against normalized geometry.

---

## 3. Sparrow instance JSON schema (ExtSPInstance)

### Construction
**File:** `web/src/import/sparrow.ts:52`

```typescript
export function solverInput(doc: Document): string {
  return JSON.stringify({
    name: doc.name,
    strip_height: doc.settings.materialWidthMm,  // ← derived from Settings
    items: doc.parts.filter(part => part.quantity > 0).map((p, id) => ({
      id,
      demand: p.quantity,
      allowed_orientations: p.rotations.kind === 'continuous' ? undefined : p.rotations.degrees,
      shape: { type: 'simple_polygon', data: p.outer },
      // ↑ Holes are OMITTED in the solver input
    }))
  });
}
```

### Schema
The JSON passed to the WASM solver (`cli.json` in exports) conforms to jagua-rs `ExtSPInstance`:

```json
{
  "name": "albano",
  "strip_height": 4900.0,
  "items": [
    {
      "id": 0,
      "demand": 2,
      "allowed_orientations": [0.0, 180.0],  // optional; null/undefined = continuous
      "shape": {
        "type": "simple_polygon",
        "data": [[x1, y1], [x2, y2], ...]
      }
    }
  ]
}
```

**Type source:** `web/wasm/src/lib.rs:78` — `let external: ExtSPInstance = serde_json::from_str(input)`

**Holes:** Part holes are preserved in the Studio `Project` and in SVG/DXF exports, but **stripped from the solver input** (`solverInput` only sends `p.outer`). The spec's requirement to reserve hole footprints is **not currently implemented** — the solver sees simple polygons only.

---

## 4. How `strip_height` reaches the solver

### Storage → Solver flow

1. **Persisted in Project:** `settings.materialWidthMm` (TypeScript `Settings` interface)
2. **Saved to IndexedDB:** The `Project` object stores `materialWidthMm` at `recovery.latest`
3. **Passed to solver input builder:** `solverInput(doc)` reads `doc.settings.materialWidthMm`
4. **Renamed to `strip_height`:** The solver JSON uses the jagua-rs field name: `strip_height: doc.settings.materialWidthMm`
5. **Validated in WASM:** `web/wasm/src/lib.rs:80` — checks `external.strip_height.is_finite()` and range constraints
6. **Imported by jagua-rs:** `import_instance(&importer, &external)` converts `ExtSPInstance` → `SPInstance`

**Answer:** `strip_height` is **not stored separately**. It is **computed at solve time** from `settings.materialWidthMm`, which is the persisted field.

### Import (reverse direction)
When importing a sparrow JSON file:  
**File:** `web/src/import/sparrow.ts:47`

```typescript
materialWidthMm: number(input.strip_height) * scale
```

The imported `strip_height` becomes `materialWidthMm` in the Studio project.

---

## 5. The real jagua-rs 0.8.1 BPP API

### Dependency
**File:** `web/wasm/Cargo.toml:22`

```toml
jagua-rs = { version = "=0.8.1", features = ["spp"] }
```

**Current feature:** `spp` (strip packing)  
**Available feature:** `bpp` (bin packing) — confirmed present in the crate  
**Source location:** `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/jagua-rs-0.8.1/src/probs/bpp/`

### BPP external representation types
**File:** `jagua-rs-0.8.1/src/probs/bpp/io/ext_repr.rs`

```rust
/// Bin Packing Problem instance
pub struct ExtBPInstance {
    pub name: String,
    pub items: Vec<ExtItem>,
    pub bins: Vec<ExtBin>,
}

/// Item with a demand
pub struct ExtItem {
    #[serde(flatten)]
    pub base: crate::io::ext_repr::ExtItem,  // id, allowed_orientations, shape, min_quality
    pub demand: u64,
}

/// Bin with a stock quantity and cost
pub struct ExtBin {
    #[serde(flatten)]
    pub base: crate::io::ext_repr::ExtContainer,  // id, shape, zones
    pub stock: usize,    // number available
    pub cost: u64,       // cost per bin
}

/// Bin Packing Problem solution
pub struct ExtBPSolution {
    pub cost: u64,
    pub layouts: Vec<ExtLayout>,  // one per used bin
    pub density: f32,
    pub run_time_sec: u64,
}
```

### Base ExtContainer type
**File:** `jagua-rs-0.8.1/src/io/ext_repr.rs:20–31`

```rust
pub struct ExtContainer {
    pub id: u64,
    pub shape: ExtShape,  // Rectangle | SimplePolygon | Polygon | MultiPolygon
    /// Zones within the container with varying quality. 
    /// Holes in the container shape are treated as zones with quality 0.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub zones: Vec<ExtQualityZone>,
}

pub struct ExtQualityZone {
    pub quality: usize,  // quality 0 = hole (forbidden)
    pub shape: ExtShape,
}
```

**Container implementation:** `jagua-rs-0.8.1/src/entities/container.rs:89–92`
```rust
/// Represents a zone of inferior quality in the Container
pub struct InferiorQualityZone {
    /// Quality of this zone. Higher qualities are superior. 
    /// A zone with quality 0 is treated as a hole.
    pub quality: usize,
    // ...
}
```

**Confirmed:** jagua-rs **does** expose quality zones, and **does** treat `quality: 0` zones as holes/forbidden regions (spec §2a reference confirmed).

### Layout and placement types
**File:** `jagua-rs-0.8.1/src/io/ext_repr.rs:77–106`

```rust
pub struct ExtLayout {
    pub container_id: u64,
    pub placed_items: Vec<ExtPlacedItem>,
    pub density: f32,
}

pub struct ExtPlacedItem {
    pub item_id: u64,
    pub transformation: ExtTransformation,
}

pub struct ExtTransformation {
    pub rotation: f32,         // degrees
    pub translation: (f32, f32),  // (x, y)
}
```

### What the bridge would need to construct

**For input (TypeScript → Rust):**

| Studio concept | BPP field | Notes |
|----------------|-----------|-------|
| `settings.materialWidthMm` × `settings.materialHeightMm` | `ExtBin.base.shape` | Rectangle with sheet dimensions |
| Infinite supply | `ExtBin.stock` | Set to `usize::MAX` or a large number |
| Sheet count minimization | `ExtBin.cost` | Set to 1 (all bins equal cost) |
| `part.outer` | `ExtItem.base.shape` | Already sent as `SimplePolygon` |
| `part.quantity` | `ExtItem.demand` | Already mapped |
| `part.rotations` | `ExtItem.base.allowed_orientations` | Already mapped |
| Holes (future) | `ExtItem.base.shape` as `Polygon` with `inner` | **Not currently sent** |
| Defect zones (future) | `ExtBin.base.zones` | Empty array in V1 |

**For output (Rust → TypeScript):**

| BPP result | Studio needs | Notes |
|------------|--------------|-------|
| `ExtBPSolution.layouts` | Sheet count, per-sheet layouts | Array length = sheet count |
| `ExtLayout.container_id` | Sheet identifier | Map back to bin type (likely all same type in V1) |
| `ExtLayout.placed_items` | Part placements | Map to `Placement[]` with `partId`, `copyIndex`, `xMm`, `yMm`, `angleDeg` |
| `ExtLayout.density` | Per-sheet utilization | Already computed by jagua-rs |
| `ExtBPSolution.cost` | Sheet count | In V1 with unit cost, `cost === sheet_count` |

### Import function
**File:** `jagua-rs-0.8.1/src/probs/bpp/io/import.rs:11`

```rust
pub fn import_instance(importer: &Importer, ext_instance: &ExtBPInstance) -> Result<BPInstance>
```

**What it does:**
- Validates item IDs are consecutive from 0, filters demand > 0
- Validates bin IDs are consecutive from 0, filters stock > 0
- Converts external shapes to internal collision-detection geometry via `importer.import_item()` and `importer.import_container()`
- Returns `BPInstance` ready for the solver

**Importer:** Already exists in the codebase — `web/wasm/src/lib.rs:87` constructs it with clearance and collision-detection config:
```rust
let importer = Importer::new(config.cde_config, None, (clearance > 0.0).then_some(clearance), None);
```

**Compatibility:** The current SPP bridge already uses `Importer` — switching to BPP reuses it.

---

## 6. Placement sampling from spec §2b

### Spec requirement (§2b, line 132)
> **Candidate positions** come from jagua-rs's own placement sampling against the inner-fit region — vertices and edges of already-placed parts and of the sheet boundary. **Not a Cartesian grid, and not bottom-left only.**

### Search results
**Searched:** `jagua-rs-0.8.1/src/` for:
- `"sampl"`, `"placement"`, `"candidate"`, `"inner.*fit"`, `"fit.*region"`

**Found:** No public API explicitly named "placement sampling" or "candidate generation" in jagua-rs 0.8.1.

### What jagua-rs provides
**Collision detection only:** jagua-rs is a geometry engine — it tests whether a placement is valid (no overlap, respects clearance, inside container). It does **not** expose a high-level "suggest candidate placements" API.

### Where placement logic lives
**sparrow** (the heuristic solver) generates candidate placements. Confirmed by inspecting:
- **File:** `web/wasm/Cargo.toml:21` — `sparrow = { git = "...", rev = "ed1c72c..." }`
- **Used in:** `web/wasm/src/lib.rs:107` — `optimize(instance, rng, listener, terminator, config)`

sparrow's optimizer internally samples placements during local search. The sampling strategy (vertices, edges, inner-fit polygon) is **in sparrow's code**, not in jagua-rs.

### Conclusion
**The spec assumes jagua-rs exposes placement sampling — it does not.**

- **jagua-rs provides:** geometry representation, collision detection, quality zones, container/item/bin abstractions.
- **sparrow provides:** the search heuristic that generates and evaluates placements.
- **BPP placement generation** will need to be implemented **in sparrow** (or in a new heuristic), not called from jagua-rs.

The existing sparrow solver already samples placements for SPP. Extending it to BPP requires:
1. Teaching sparrow's placement generator about multiple containers (bins)
2. Adding cross-bin relocation moves to the search neighborhood
3. Adjusting the cost model to account for per-bin overlap (spec §WP2)

**No breaking discovery:** sparrow is already the placement solver. The spec's wording "jagua-rs's own placement sampling" is imprecise — it should say "sparrow's placement sampling, evaluated using jagua-rs collision detection."

---

## 7. Git status and baseline tag

### Git status
```
On branch main
Your branch is up to date with 'origin/main'.

Untracked files:
  MULTI_SHEET_SPEC_v3.md
  WOODAAKAR_NESTING_EDR_v1.md

nothing added to commit but untracked files present
```

**Status:** Clean working tree (no modified or staged files). Two untracked markdown files present but do not affect code.

### Baseline tag
```
$ git rev-parse sparrow-studio-baseline
66800eed664a3505928eb2f34732711dd0ab5c34
```

**Status:** Tag resolves to commit `66800ee`

**Verification:**
```
$ git show sparrow-studio-baseline:README.md | head -5
# sparrow/studio

**Free, open-source nesting software that runs in your browser.**
...
```

Tag points to the pre-rebrand state (title still "sparrow/studio"). Confirmed valid.

---

## Summary of gaps where spec assumes code does not

1. **Hole footprint reservation (§2a):** The spec requires holes to reserve their footprint area (no part-in-hole nesting in V1). **Current code strips holes from the solver input entirely** — `solverInput()` only sends `part.outer`. Holes are preserved in the Project and in exports, but the solver never sees them.

2. **`strip_height` field name:** The spec uses `strip_height` throughout migration and schema discussion. **Actual persisted field:** `settings.materialWidthMm`. `strip_height` is only the JSON key in the solver input, not in saved projects.

3. **Placement sampling in jagua-rs:** §2b and Appendix A7 reference "jagua-rs's placement sampling." **jagua-rs does not expose placement sampling** — it only provides collision detection. Placement generation is in **sparrow**.

4. **Multi-sheet schema fields:** The spec assumes `sheetWidth`, `sheetHeight` will be added. **Current schema:** only `materialWidthMm` exists. No height field yet.

5. **Machine profile:** The spec mandates `machineType: 'router' | 'laser'` in V1. **Current schema:** no `machineType` field exists. This is entirely new.

6. **Rotation semantics:** The spec defines `rotationMode`, `rotationStepDegrees`, `allowedAnglesDegrees`, `allowMirror`, `grainLocked`. **Current schema:** only `rotations: RotationRule` exists, with `{ kind: 'discrete'; degrees: number[] } | { kind: 'continuous' }`. The new fields are an expansion.

7. **Schema version migration:** The spec details migration from strip to sheet projects. **Current code:** has `schemaVersion: 1` but no migration logic (v1 is the only version that has ever existed).

All gaps are expected — this is discovery before implementation. The spec is a design document, not a description of current state.

---

**Discovery complete.** Code changes ready to proceed per spec work packages.
