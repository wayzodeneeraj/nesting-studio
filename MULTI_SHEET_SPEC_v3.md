# Woodaakar Nesting — Multi-Sheet Implementation Specification

**Version 3. 15 September 2026. This is the final specification revision.**

**Changes in v3:** split runtime verification from CI verification; resolved the machine-profile contradiction; defined rotation semantics exactly; defined utilisation and the lower bound under the hole policy; corrected clearance handling in preflight; defined placement candidate generation; separated serial from threaded reproducibility; made migration contingent on inspecting the real schema; replaced "ship after phase 5" with alpha/beta/production gates; softened the licence wording.

**Stop rule.** v1 → v2 → v3 each added requirements and raised the estimate. Every addition was defensible; the process is not. A fourth review will find a fourth list, because specifications of this kind are never finished — they are abandoned at a useful point. **This is that point.** The next artifact produced on this project should be code and a test corpus, not a v4.

Sections are marked **[V1]** (required for first working release) or **[LATER]** (real, but must not block it).

---

## 1. Current state of the project

**Repository:** fork of `JeroenGar/sparrow-studio`, renamed `nesting-studio`
**Local path:** `D:\dev\nesting-studio`
**GitHub:** `github.com/wayzodeneeraj/nesting-studio`
**Baseline tag:** `sparrow-studio-baseline` (pre-rebrand working state)
**Live at:** `woodaakar.in/nest/` — deployed by copying `web/dist` into a `nest/` folder inside the website folder and drag-dropping the whole site folder to Netlify

**Stack:**
- Rust solver compiled to WebAssembly, four variants (serial/threaded × SIMD/no-SIMD)
- `jagua-rs 0.8.1` from crates.io, unmodified — collision detection engine, **MPL-2.0**
- `sparrow` pinned to git rev `ed1c72cf244759e61f9881a93326e2e35e0514e6` — search heuristic, **MIT**
- Frontend: TypeScript + React + Vite, `base: '/nest/'`
- Build: stable Rust + nightly-2026-08-30 with `rust-src` + wasm-pack 0.15.0 + Node 24

**Build commands** (from `web/`):
```
npm ci
npm run wasm:build     # ~10 min, builds all four variants
npm run dev            # dev server at 127.0.0.1:5173
npm run typecheck
npm run build          # production build to web/dist
```

---

## 2. The problem to solve

### What the engine does today

**Strip Packing (SPP).** One container of fixed width and unbounded length. Place all parts, minimise the length used. Enabled by `features = ["spp"]` in `web/wasm/Cargo.toml` (line 22). The input JSON carries `strip_height`, which is the fixed material width. See `web/wasm/src/lib.rs` around lines 78–84.

### What is needed

**Bin Packing (BPP).** Multiple containers of fixed width *and* fixed height — real sheets, e.g. 2440 × 1220 mm. Distribute all parts across as few sheets as possible.

### Why this is not a configuration change

The SPP formulation has exactly one container. Every move in the search relocates a part within that container. Bin packing adds a decision that does not exist in the current code: **which sheet does this part belong to.** Resolving a stuck layout often requires moving a part from sheet 3 to sheet 1, which disturbs sheet 1 and may cascade. That move must be written, and it is the core of the work.

### What already exists and should be used

`jagua-rs 0.8.1` ships a `bpp` feature with a complete multi-bin problem representation. Confirmed present: `bpp/io/ext_repr.rs` defines `ExtBin` containing an `ExtContainer`, which has a `zones` field for quality zones. A zone with quality 0 is treated as a hole — a forbidden region. `container.rs` lines 89–98 document this.

**Do not write a new collision engine or a new nesting heuristic.** The geometry is solved. The work is the bin-packing layer on top.

---

## 2a. Machine profile and hole policy **[V1]**

### Machine profile — minimal, but real, in V1

v2 referenced a machine profile in two places while listing profiles as future work. That was a contradiction. Resolve it with two profiles in V1:

```
machineType: 'router' | 'laser'
```

Each sets defaults the user can override: kerf, default part clearance, default edge margin, and whether part-in-hole is offered at all. Waterjet, plasma and drag knife are **[LATER]** — they are additional rows in the same table, not new behaviour.

Do not ship `machineType: 'unspecified'`. A nesting result whose safety depends on the cutting process should not be produced without knowing the process.

### Hole policy

A part's holes serve two unrelated purposes, and conflating them is how unsafe layouts get produced.

**Rule:**

> All holes are preserved in part geometry, in the on-screen preview and in every export. A hole's interior is **not** available as a placement region for any other part — the solver reserves the part's entire outer footprint.

This matches current shipping behaviour. **In V1 this rule is unconditional: part-in-hole is disabled for both profiles**, so no code path depends on a feature that does not exist yet.

Part-in-hole is **[LATER]**. When it arrives it is gated on `machineType === 'laser'`, with a minimum bridge width between the inner part and the hole wall, and a cut-order warning in the report. It stays off for routers: cutting the parent's hole releases the inner part, loses vacuum hold-down through the opening, and constrains cut order.

---

## 2b. Initial feasible assignment, clearance and areas **[V1]**

### Clearance semantics — three distinct distances

Sloppy wording here produces either unsafe layouts or wasted material. Define once:

| Term | Meaning |
|---|---|
| `partClearance` | minimum distance between two different parts |
| `edgeMargin` | minimum distance between a part and the sheet boundary |
| `defectClearance` | minimum distance from a forbidden zone **[LATER]** |

`partClearance` does **not** shrink the sheet. A single part on an empty sheet is constrained by `edgeMargin` alone. Only apply a boundary clearance beyond `edgeMargin` if a shop rule explicitly calls for it, and if so make it a separate named setting.

```
usableSheetArea = (sheetWidth − 2·edgeMargin) × (sheetHeight − 2·edgeMargin)
```

### Two area measures — report both, never conflate

Because holes are reserved rather than nestable, two different areas exist:

- **Net material area** — outer contour minus holes. The material you actually consume.
- **Reserved footprint area** — outer contour with holes filled. What the solver occupies.

Report:
- **Material utilisation** = Σ net material area ÷ usable sheet area
- **Placement occupancy** = Σ reserved footprint area ÷ usable sheet area

Without both, a sheet full of jali panels shows poor utilisation while being physically unable to accept another part.

### Lower bound

```
lowerBound = ceil( Σ reservedFootprintArea / usableSheetArea )
```

Use **reserved footprint**, not net material, because holes are unavailable under §2a. Display it annotated: for irregular parts this bound is typically 10–25% below what is achievable. Never present it as a target that a correct optimizer should reach.

### Initial assignment

1. Sort part instances by descending reserved-footprint area.
2. First-Fit Decreasing: for each instance, try each open sheet in order; place at the first feasible position found; if none, open a new sheet.
3. **Candidate positions** come from jagua-rs's own placement sampling against the inner-fit region — vertices and edges of already-placed parts and of the sheet boundary. **Not a Cartesian grid, and not bottom-left only.** Bottom-left construction is what produces layouts glued to one edge with large empty regions above.
4. Try orientations in the permitted set, ordered by ascending bounding-box area, capped at the first 4 during construction.
5. Fixed per-part placement time budget; on expiry, open a new sheet rather than stalling.
6. Feasibility uses the real contour. Bounding boxes are for ordering and broad-phase rejection only.

This exists to produce a starting K quickly, not to pack well. Quality comes from WP2 and WP3.

### Oversized-part preflight — before the solver starts

For each part type, test every permitted orientation against `(sheetWidth − 2·edgeMargin) × (sheetHeight − 2·edgeMargin)`. If none fits, stop and report by name:

> Part "Panel-A" (2500 × 600 mm) does not fit a 2440 × 1220 mm sheet with a 10 mm edge margin under the selected rotation constraints.

Never spend the optimisation budget on an impossible job, and never silently drop the part.

---

## 2c. Schemas, migration and determinism **[V1]**

### Migration — inspect before coding

Add an explicit `schemaVersion`. Existing saved projects live in browser IndexedDB and must keep opening.

**Do not code the migration from field names assumed in this document.** `strip_height` appears in the WASM solver input; it may or may not be the field persisted in the saved project. Before writing migration code, inspect and record:

- the IndexedDB key and stored project interface
- the exported ZIP/JSON schema
- the sparrow instance JSON schema
- the migration function's input and output types
- behaviour when migration fails — the project must still open, in a clearly flagged degraded state, never silently

**Behaviour on import of an older strip project:** carry over parts and settings; set sheet width from the strip width; assume a 2440 mm sheet length; **discard the previous placement and mark all parts unassigned, requiring a re-nest.** A strip layout longer than one sheet cannot be reinterpreted as a valid single-sheet layout, and silently truncating it would be a correctness failure. Notify the user of the assumed dimension in one line.

### Rotation — exact semantics

```ts
rotationMode: 'fixed' | 'halfTurn' | 'orthogonal' | 'incremental'
rotationStepDegrees?: number      // required when mode is 'incremental'
allowedAnglesDegrees?: number[]   // optional explicit list, overrides mode
allowMirror: boolean              // default false — mirroring flips the good face
grainLocked: boolean              // see below
```

| Mode | Angle set |
|---|---|
| `fixed` | `[0]` |
| `halfTurn` | `[0, 180]` |
| `orthogonal` | `[0, 90, 180, 270]` |
| `incremental` | `[0, s, 2s, …]` for `s = rotationStepDegrees`, while `k·s < 360` |

There is no "free" mode. Continuous rotation is not representable in preflight, in the verifier or in a reproducible run. Resolution is always explicit.

Angle-set construction, applied identically in the solver, the preflight and the verifier:
1. Generate from mode or take `allowedAnglesDegrees` if present
2. Normalise to `[0, 360)`
3. Remove duplicates within 1e-6°
4. Fold by the part's rotational symmetry order — a square at 3° steps collapses from 120 orientations to 30; a circle to 1
5. Cap the resulting set at a configured maximum and record the cap in the run record if it bites

### `grainLocked` — do not accept and ignore

Silently ignoring a manufacturing constraint is the worst failure class in this document: the layout is geometrically valid and the parts are scrap.

**V1 rule:** the field exists in the schema but is **not exposed in the interface**. If an imported project sets `grainLocked: true`, either enforce it as `halfTurn` (`[0, 180]`) or refuse the import with a clear message. Never load it and rotate freely.

### Sheet inventory — V1: one sheet size, unlimited quantity

A maximum-quantity limit introduces a new failure state ("no solution within 6 sheets") needing its own UI and stopping logic. For a quoting workflow, unlimited is right — the answer to "it needs 7 sheets" is a quote for 7 sheets, not a failure. Finite inventory, multiple sizes and remnant stock are **[LATER]** and change the objective from "count sheets" to "minimise stock cost."

### Determinism record

Every run stores and reports: random seed, solver revision, WASM variant actually initialised, thread count, time budget, rotation settings, clearance and margin, machine profile, schema version.

**Reproducibility differs by execution mode, and the document must not promise what threading cannot deliver:**

- **Serial solver:** same version, seed and settings must produce a bit-identical result. This is the mode used for regression tests and for investigating a customer complaint.
- **Threaded solver:** worker completion order varies, so exact reproduction is not guaranteed. The requirement is that it produces a **valid** result satisfying the same safety invariants, and that the run record is complete enough to explain what happened.

A regression test asserting bit-identical output must pin the serial variant.

---

## 3. Work packages

### WP1 — Switch the WASM bridge from SPP to BPP

**Files:** `web/wasm/Cargo.toml`, `web/wasm/src/lib.rs`, and the TypeScript that builds the solver input.

1. Change the `jagua-rs` feature from `spp` to `bpp` (or enable both during transition).
2. Replace the strip input (`strip_height` + computed initial length) with a bin definition: sheet width, sheet height, quantity available, and optionally quality zones.
3. Update the result type: instead of one layout with a used length, return N layouts, each with its own placements and utilisation.
4. Update the TypeScript types and the input-building code to match.

**Done when:** a fixed number of sheets can be passed in, parts are placed across them, and the result comes back as a list of per-sheet layouts. Quality is not the goal yet — correctness of the data path is.

**Risk:** low. Mechanical work, compiler catches mistakes.

---

### WP2 — Cross-sheet moves in the search

**This is the hard part and most of the schedule.**

Sparrow's heuristic works by allowing parts to overlap temporarily, then using guided local search to separate them: repeatedly pick the part with the worst overlap cost and move it to the position and orientation that minimises that cost, with escalating weights on persistently-overlapping pairs so the search escapes local minima.

In strip packing, "move" means translate and rotate within the single strip. For bin packing, the move neighbourhood must include **relocating a part to a different sheet**.

Requirements:
- A move operator that transfers a part from sheet *i* to sheet *j*, evaluating candidate positions and orientations in the destination.
- Cost evaluation that accounts for overlap created in the destination sheet, not just overlap removed from the source.
- No structural path that creates sheet N+1. Overflow must manifest as unresolved overlap, i.e. a failed attempt — never a silently added sheet.

**Cost model — get this precise before writing code.** Parts on different sheets cannot physically overlap, so the penalty structure is not simply "global":

- Overlap penalties apply **only between parts currently assigned to the same sheet**. Two parts on different sheets contribute zero overlap cost to each other.
- Guided-local-search weights are keyed by **part pair identity and persist globally**, so history is not lost when a part moves sheets and later returns.
- A stale weight must never penalise a pair that is currently on different sheets. Weight is history; cost is evaluated against the present assignment.
- On relocation, a part's cost is recomputed against the destination sheet's parts, its boundary and any defect zones.

Getting this wrong produces a search that either thrashes or converges to a poor assignment and refuses to leave it.

**Done when:** a layout that cannot resolve within its current sheet assignment can be fixed by the search moving parts between sheets, and the final result is verified overlap-free.

**Risk:** high. This is where a bug produces overlapping parts, which on a CNC router means a broken tool or a ruined sheet. Every candidate result must pass independent geometric verification before being shown or exported — the app already has a "Geometry checked" mechanism; it must be extended to cover all sheets.

---

### WP3 — Sheet-count scheduling

The outer loop that decides how many sheets to attempt.

```
1. Construct an initial feasible solution → K sheets
2. Attempt K−1: run the fixed-K feasibility search with a time budget
3. If feasible, accept and repeat at K−2
4. If the budget is exhausted, stop
5. Report the best found
```

Additional requirements:

- **Lower bound:** `ceil(totalPartArea / usableSheetArea)`. Display it, but annotate honestly — for irregular parts this bound is typically 10–25% below what is achievable.
- **Never display "optimal."** Use "Best solution found." A failed K−1 attempt proves nothing except that this heuristic, with this seed, in this budget, did not find one.
- **Sparse-sheet elimination:** when a K−1 attempt stalls, destroy the lowest-utilisation sheet *and* remove 15–30% of parts from the receiving sheets (radius-based around a random seed point), then re-insert the whole pool. Removing only the sparse sheet's parts into otherwise-frozen sheets does not work — there is nowhere to put them.
- **Time budgets** per depth tier. Longer tiers must diversify — more restarts, different random seeds, wider rotation sets — not merely run the same search longer.

**Risk:** medium. Mostly logic, but the stopping rules need tuning against real jobs.

---

### WP4 — User interface

- Sheet **width and height** inputs, replacing strip width. Presets for standard sizes (2440×1220, 3050×1220, 8×4 ft).
- Sheet navigation: "Sheet 1 of 3" with next/previous, or a thumbnail strip.
- Per-sheet statistics: utilisation, part count.
- Overall statistics: sheet count, total utilisation, area lower bound, parts placed vs requested.
- **Export:** see §4a.
- Report: material, sheet size, quantities, sheet count, utilisation, runtime.
- Progress display during the K-reduction: "Testing 2-sheet feasibility…", elapsed time, current best.

**Cancellation and recovery.** The app already has a working Stop that disposes the solver coordinator and its worker pool. Extend it to the K-loop:
- Stop is responsive during any feasibility attempt, not only between attempts.
- Stopping mid-attempt keeps the last **verified** solution — an abandoned K−1 attempt never destroys the working K result.
- Workers terminate without leaving the interface locked.
- A result arriving from a cancelled attempt is discarded, not displayed. Guard against stale worker messages.

**Risk:** medium. More work than it looks — sheet navigation, per-sheet stats and the export contract are each non-trivial. Budget a week.

---

## 4a. Export contract **[V1]**

Leaving this open invites an arbitrary choice. Default:

**"Download layouts" produces a ZIP containing:**
- `sheet-01.dxf`, `sheet-02.dxf`, … — one file per sheet
- `overview.svg` — all sheets, for visual check and for the shop floor
- `report.json` — machine profile, material, sheet size, clearance, margin, per-sheet utilisation, part counts, unplaced parts, runtime, and the full determinism record from §2c
- The existing third-party notice text

Every sheet DXF uses the **same origin and coordinate convention**, with units and sheet dimensions embedded. A single combined DXF with sheets offset in X may be offered as a secondary option, but it is not the default — separate files match how a CAM operator actually loads a job.

Retain the existing distinction between checked and unchecked exports: only independently verified layouts are labelled as checked.

---

## 4. Verification requirements

Non-negotiable. A nesting error costs material and tooling.

**Two verifiers are required, and v2 conflated them.** A Python script in CI cannot validate a result generated in a customer's browser.

### Runtime verifier — in the app, on every result **[V1]**

Written in TypeScript or WASM, running **independently of the search state**: it reconstructs geometry from the result and checks it from scratch, trusting nothing the solver recorded. It blocks display and export on any failure.

- No pair of part contours overlaps, on any sheet
- Pairwise **clearance** is satisfied, not merely absence of overlap — two parts 0.1 mm apart under a 3 mm `partClearance` is a failure
- Every part lies inside `sheet − edgeMargin`
- Each part's orientation is in its permitted set, and no part is mirrored unless `allowMirror` is set
- `parts placed == parts requested`, exactly, per part type and identity
- Holes preserved and, per §2a, not used as placement regions
- All coordinates finite; no transformed contour self-intersecting or degenerate
- Defect zones respected — **[LATER]**; in V1 the zone list is empty and the check is a no-op

Implementing the runtime verifier as a second, independent implementation is deliberate. If the fast engine has a bug, the slow checker catches it.

### Offline verifier — in CI, on fixtures and exports **[V1]**

The existing shapely and ezdxf audit scripts, extended to multi-sheet. These:

- re-open **exported** DXF files and check them as a CAM operator's software would
- test fixtures independently of the app
- detect disagreement between the two verifiers, which is the most valuable signal either produces
- gate deployment

**Verify the exported geometry, not only the internal layout.** A valid internal result can still be broken by DXF conversion, unit conversion, rounding or coordinate transformation.

### Tolerances

The app currently validates with 1e-6 mm linear and 1e-8 mm² per-pair overlap tolerance, and never loosens them on failure. **Keep those values.** They are numerical comparison thresholds; at float64 precision they are not tight, and the app already passes real DXFs with them. Manufacturing safety comes from `partClearance` and `edgeMargin` — positive, millimetre-scale distances — not from the comparison threshold. Keep four concepts distinct in code: comparison tolerance, part clearance, edge margin, export rounding precision. Never trade one against another to make a check pass.

**If a part cannot be placed, name it explicitly in the results.** Never silently drop a part.

---

## 5. Regression tests

Build these before starting WP2, not after.

Collect real Woodaakar DXFs, especially the jobs that previously nested badly, and assert hard limits on sheet count and utilisation.

**This is the highest-value item in the whole document and it is currently missing.** Without real job files, every quality claim is theory. Gather them before WP2 starts.

Synthetic cases:
- Convex, concave, asymmetric, tessellated curved shapes
- Parts with one and several holes
- Repeated identical parts; mixed quantities; zero quantity; very large quantity
- Near-tangent geometry and narrow necks
- One part larger than the sheet (must trigger preflight, not a solver run)
- A part that fits exactly, to the tolerance
- A part equal to sheet width after clearance is applied
- Clearance violation with no contour overlap
- Defect zone touching a part boundary
- Duplicate part identifiers; invalid units; inch-to-millimetre conversion
- Restricted rotation sets, including 0° only
- Cancellation mid-K−1 search
- Same seed, same result (reproducibility)
- Serial vs threaded WASM producing equally valid — not necessarily identical — layouts
- Export then re-import round trip
- Old-schema project migration
- Malformed and hostile DXF input

Every test asserts overlap-free, clearance-satisfied and exact quantities. Golden tests should store verified invariants, not only utilisation thresholds — a utilisation number can regress for good reasons, an overlap never can.

---

## 6. Licence constraints — do not breach these

- **`jagua-rs` is MPL-2.0.** File-level copyleft. It has no SaaS clause, but shipping WASM to a browser *is* distribution, which triggers the obligation to make the source of covered files available.
- **Practical rule: never edit `jagua-rs` source files in place inside the private repo.** If changes are needed, maintain a public fork and depend on that. Prefer extending via separate crates — new files carry your own licence.
- **`sparrow` is MIT.** Preserve the copyright notice.
- **These files must ship with every build and must not be deleted:** `LICENSE`, `web/public/THIRD_PARTY_NOTICES.txt`, `web/public/RUST-LIBRARY-nightly-2026-08-30.html`, `web/public/RUST-LIBRARY-stable.html`.
- The About dialog is the designated user-accessible location for sparrow and jagua-rs attribution, licence links and source-availability information. **It must remain unless an equivalent, continuously accessible notice mechanism replaces it.** The licences require notices, licence text and source availability for covered files; whether those must appear in an About dialog specifically is a legal interpretation, not a settled fact — but removing the dialog without putting the notices somewhere equally reachable would breach the obligation.

None of the above is legal advice. The MPL question worth a lawyer's eye is whether bundling MPL-derived object code with proprietary object code into a single `.wasm` artifact is a "Larger Work" under MPL §3.3 — the reading here is that it is, and that §3.2's source-availability notice is the full obligation, but that is the point to confirm before commercial scale.

---

## 7. Estimate

**Three to six weeks** for someone competent in Rust and computational geometry, working steadily.

| Package | Estimate | Risk |
|---|---|---|
| Schema, preflight, both verifiers, test corpus | 1–1.5 weeks | medium |
| WP1 — BPP bridge | 1 week | medium — four WASM variants, serialisation, workers, saved projects |
| WP2 — cross-sheet moves | 2–3 weeks | **very high** |
| WP3 — sheet scheduling | 1 week | medium–high |
| WP4 — interface, export, cancellation | 1–1.5 weeks | medium |
| Migration and compatibility | 0.5 week | medium |
| Tuning against real jobs | ongoing | high |

**Internal alpha: 5–7 weeks. Customer-facing release: 8–10 weeks.** One competent developer, working steadily, with real DXF jobs available from week one.

A note on the upper end. This is an internal production tool for one workshop, not commercial CAM software. The person running it can look at a layout and judge it. That is a legitimate quality gate and it is worth roughly three weeks of automated polish. Don't spend twelve weeks building certainty that a human glance provides in five seconds — but don't skip the verifiers, because a human glance does not catch a 0.3 mm clearance violation.

---

## 8. Release gates

v2 said "ship after phase 5," which contradicted marking migration and cancellation as V1 safety requirements. Corrected:

| Gate | Evidence required |
|---|---|
| **Foundation complete** | Schema tests pass; preflight rejects oversized parts by name; both verifiers run on fixtures; real-DXF corpus collected |
| **Fixed-K alpha** | Multiple sheets returned through the WASM bridge with exact quantities; runtime verifier passes |
| **Search alpha** | Cross-sheet relocation demonstrably resolves cases that single-sheet assignment cannot |
| **Export alpha** | Every exported DXF re-parses and passes the offline audit |
| **Internal beta** — Neeraj uses it for real jobs | Migration, cancellation and stale-worker tests pass; K-reduction working |
| **Customer-facing release** | Real Woodaakar jobs reviewed and accepted against manually approved nests; all four WASM variants verified; licence artifacts present in the deployed build |

**Internal beta is the milestone that matters.** Using it on real work will find more problems in a week than another month of specification.

### Build order

1. **Safety foundation** — schema and migration, preflight, both verifiers, regression corpus from real DXFs.
2. **Fixed-K prototype** — multiple sheets through the WASM bridge with minimal navigation. Packs badly; that is fine.
3. **Cross-sheet optimisation** — relocation moves, corrected cost model, diversification.
4. **Sheet-count reduction** — K−1 scheduling, ruin-and-recreate, honest stopping rules.
5. **Production export** — per-sheet DXF ZIP, overview, report, verified end to end.
6. **Compatibility and UX** — migration notices, cancellation, progress.
7. **Real-job acceptance** — Woodaakar DXFs compared against manually accepted nests.

---

## 8a. Working practice

Commit often. Tag working states. The one command that loses work is `git checkout` on a modified file — be careful with it.

---

## 9. Known gaps not covered here

- **Part-in-hole nesting** — jagua-rs supports quality zones that could enable it, but it is unsafe on a CNC router (vacuum loss through the cut hole, released parts thrown by the tool, cut-order constraints). Recommended off by default for router and MDF; optional for laser and acrylic. Separate piece of work.
- **Machine profiles** — router, laser, waterjet, plasma, with sensible kerf and gap defaults. Independent of multi-sheet; can be done any time.
- **Grain and face direction** — free rotation ruins veneered and grain-directional stock. Needs a per-part constraint flag. Currently not modelled at all.
- **Remnant consolidation** — pushing waste into one usable rectangular offcut. Only meaningful on partly-filled sheets. Should be a tie-break among equal-sheet-count solutions, never a reason to use an extra sheet.

---

## Appendix — implementation notes (added after review, not a v4)

Seven corrections recorded here rather than by revising the body, per the stop rule in the header.

**A1. Lower bound — use reserved footprint everywhere.** WP3 repeats the older wording `ceil(totalPartArea / usableSheetArea)`. §2b governs:
```
lowerBound = ceil( Σ reservedFootprintArea / usableAreaPerSheet )
```

**A2. Utilisation denominators.** For N sheets:
```
overallMaterialUtilisation  = Σ netMaterialArea       / (N × usableAreaPerSheet)
overallPlacementOccupancy   = Σ reservedFootprintArea / (N × usableAreaPerSheet)
```
Per-sheet statistics use that sheet's usable area only.

**A3. "Same seed, same result" is conditional.** Bit-identical reproduction is required only for the serial variant under a pinned solver revision and pinned WASM build. Threaded runs must produce an equally *valid* result, not an identical one. SIMD and non-SIMD builds need not agree bit-for-bit.

**A4. WP1 risk is medium, not low.** The body still says low in one place; the estimate table is correct. It touches four WASM variants, workers, serialisation, saved projects, TypeScript contracts and result rendering.

**A5. Machine profiles in §9.** Router and laser are **V1, mandatory**. Only waterjet, plasma and drag knife are LATER.

**A6. Runtime verifier — architectural decision.** A full reimplementation of polygon geometry in TypeScript risks introducing a second, independent set of geometry bugs, which is not obviously better than one. **Decision for V1:** the runtime verifier reconstructs all state independently from the result — placements, orientations, transformed contours, sheet assignment — but may reuse trusted collision primitives rather than reimplementing them. Genuine implementation independence is supplied by the shapely/ezdxf offline verifier in CI. Revisit only if the two verifiers ever agree on something wrong.

**A7. Two API assumptions to confirm during repository discovery.** Do not implement against these until verified at the pinned revisions:
- that jagua-rs's BPP representation provides everything the bridge needs;
- that jagua-rs exposes the placement sampling described in §2b.

If either differs, adapt the implementation — but not the safety requirements.

---

## Appendix — first tasks

**Repository discovery, before any code changes.** Record, in a file committed to the repo:
- the IndexedDB key and stored project interface
- the exported ZIP/JSON schema
- the sparrow instance JSON schema
- how `strip_height` reaches the solver, and what is actually persisted
- the real jagua-rs BPP API at 0.8.1, and whether placement sampling is reachable
- confirmation that the working tree is clean and `sparrow-studio-baseline` still resolves

**Test corpus — the blocker.** 15–25 real jobs, geometry preserved, customer-identifying text removed if needed:
- jobs that currently nest well, and jobs that nested badly
- large repeated panels; mixed small and large parts
- jali panels with holes; concave profiles
- restricted-rotation jobs; parts near sheet size
- both router and laser jobs
- manually approved nests for comparison, where they exist

Store with the sheet size, part clearance and edge margin actually used on each job. A DXF without its settings is half a test case.
