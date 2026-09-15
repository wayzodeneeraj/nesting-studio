# Woodaakar True-Shape Nesting — Engineering Decision Record v1

**Date:** 14 September 2026
**Status:** Steps 1–5 complete (audit, engine selection, licence audit, architecture, optimizer configuration). Steps 6–9 are specified but **not executed** — see §0.
**Author role:** architecture / computational geometry / licence review

---

## 0. Honest scope statement — read this first

Three things you asked for that I did **not** do, and must not be reported as done:

1. **No repository access.** This session had no filesystem or git access to your existing `woodaakar.in/nest/` project. Step 6 (implementation) is therefore a build plan, not an implementation. I have not written, modified, or inspected a single line of your code.
2. **No real Woodaakar DXFs.** Nothing was uploaded. Steps 7 and 9 (benchmarks vs. your 13-sheet / 32.7% / 4-sheet failures) are impossible to execute. Those files are the single most valuable thing you can give me next.
3. **Licence findings are documentary, not legal advice.** I verified licence declarations from upstream repositories and package registries on this date. Declared licences change, and a declared licence at repository root is not a licence audit of the dependency tree. §3 lists exactly what must still be checked mechanically and what should go to a lawyer.

Everything below is an engineering position I am prepared to defend, including the parts that disagree with your brief.

---

## STEP 1 — REQUIREMENTS AUDIT

Your brief is unusually well specified for this domain. The problems are not sloppiness — they are genuine tensions that any real implementation has to resolve, plus a few missing decisions that will bite during fabrication rather than during coding.

### C1. "Browser-preferred" vs. "optimization quality matters most"

**Conflict.** §3 prefers in-browser. §36 and §38 say optimization quality dominates. These pull opposite ways: WASM in a browser is roughly 1.5–3× slower than a native `-C target-cpu=native` build, and browser threading requires cross-origin isolation (COOP/COEP headers) plus `SharedArrayBuffer`, which some mobile browsers and embedded webviews restrict.

**Resolution (recommended):** Build browser-first, but architect the solver as a **portable Rust core with two shells** — a `wasm32` shell and a native shell behind an HTTP API. Same crate, same seeds, same algorithm. Ship Phase 1 browser-only. If benchmarking on real jobs shows the browser build losing ≥1 sheet on ≥5% of jobs versus native, flip the Deep tier to the server and keep Fast/Balanced local. This is a runtime switch, not a rewrite.

**Consequence you must accept:** on a customer's 4-year-old Android phone, Deep mode is not going to do 300 seconds of useful search. Detect `navigator.hardwareConcurrency` and `deviceMemory`, and cap the offered depth tiers accordingly rather than promising a search you can't deliver.

### C2. FAST = "a few seconds" is not compatible with true-shape + fixed-K + fine rotation

**Conflict.** §22 wants a few-second preview. §14 wants active fixed-K feasibility attempts. §11 wants fine-angle search. On a 300-part job with concave profiles, the collision-detection warm-up alone (building the shape representations, the quadtree, the orientation sets) can eat that budget.

**Resolution:** Redefine FAST honestly as **"first feasible layout, no K-reduction, cardinal rotations only."** It is a preview of *what you're cutting*, not a nesting result. Label it in the UI as such — `Preview only — not optimized for sheet count`. Do not let a customer quote off a FAST result. Balanced is the minimum tier that runs K-reduction.

### C3. Sheet-count minimisation vs. remnant consolidation

**Partial conflict, mostly resolvable.** On a **fully consumed** sheet there is no remnant to preserve — waste is distributed in the interstices between parts and no amount of "consolidation" recovers a usable offcut. Your §19 requirement is only physically meaningful on the **last (partially filled) sheet**, and on any sheet whose utilisation is low enough that a rectangular offcut is genuinely recoverable.

**Resolution:** Make remnant quality a **tertiary objective evaluated only on sheets below a utilisation threshold** (suggest 85%). Objective vector becomes:

```
minimise ( K ,  -Σutilisation ,  -largestUsableRectangleArea(lastSheet) ,  fragmentationIndex )
```

lexicographically, exactly as §12 demands. The remnant term can never trade against K or total utilisation; it only breaks ties among equal-K, equal-utilisation layouts. That satisfies §19 without violating §12.

### C4. Strict Shop-Floor Mode will cost you yield — and that's fine if it's measured

**Disagreement with the brief.** §20A describes column-wise fill. For arbitrary concave profiles (jali panels especially), column banding is a *worse* heuristic than free placement, sometimes materially — it forbids exactly the interlocking that makes true-shape nesting worth doing.

**Resolution:** Do not implement Strict as a *placement constraint*. Implement it as a **post-optimisation compaction direction plus a mild construction bias**:
- run the same free-optimal search;
- then apply directional compaction with a left/bottom attractor and an x-centroid penalty;
- report both layouts side by side with their sheet counts and utilisations.

If Strict costs a sheet, §20 already says never increase sheet count for aesthetics — so Strict silently degrades to Free for that job, and the UI says so. This gives you the operational comparison you actually want without building a second, weaker optimizer.

### C5. **Missing requirement: grain and face direction**

Your brief lets every copy take its own angle (§7) and offers 3° increments (§9), but says nothing about grain. Plywood, veneered MDF, and directional laminates have a grain axis; melamine and veneer have a **good face**. A 27° rotation on a veneered panel is a scrap part, not an optimisation.

**Resolution — add to the part model:**
- `grainConstraint: none | axis-locked (0/180 only) | cardinal (0/90/180/270)`
- `allowMirror: bool` (default **false** — mirroring flips the good face)

Mirroring is also entirely absent from §9's rotation modes. For plain MDF and acrylic, mirroring is free extra search space and should be offered; for veneer it must be off. This is a per-material default with a per-part override.

### C6. 3° and 5° increments are counterproductive for most of your work

**Disagreement.** For orthogonal furniture/MDF components — which is the bulk of a shop like yours — fine angles:
- explode the search space with near-zero yield gain (rectangles nest optimally at 0/90);
- destroy common-line cutting opportunities;
- make tab/bridge placement and hold-down strategy harder;
- make the layout harder for the operator to sanity-check.

Fine angles pay off for genuinely irregular, asymmetric profiles: signage letterforms, curved brackets, jali motifs with non-orthogonal envelopes.

**Resolution:** Keep all seven modes as requested (§9), but:
- default to **0°+90°**;
- show an inline advisory computed from the actual geometry — if ≥80% of part area is within 2% of its bounding box area, display *"Your parts are near-rectangular. Fine angles are unlikely to help and will cost ~10× runtime."*;
- never let fine-angle mode be the *only* search — always run the cardinal search in parallel and keep the better result. Fine angles must be able to help but never hurt.

### C7. Fixed-K "feasibility" cannot prove infeasibility

**Technical correction.** §14 and §25 risk implying that a failed K-attempt means K is impossible. Irregular bin packing is NP-hard; a heuristic failing at K tells you nothing except that this heuristic, with this seed, in this time budget, failed.

**Resolution — required UI wording:**
- `Best solution found: 3 sheets`
- `Area lower bound: 2 sheets (not attainable in general)`
- `2-sheet layout not found in 43 s of search — not proven impossible`

Never `optimal`. §25 already says this; I'm reinforcing that it applies to the *lower-bound display* too, which is where the temptation to over-claim actually lives.

### C8. The area lower bound is weak and will look bad

For irregular parts the area bound is routinely 1–2 sheets below anything achievable. Displaying `Area lower bound: 2, Current best: 4` makes a correct optimizer look broken to a customer.

**Resolution:** display the bound, but annotate it: *"Theoretical minimum ignoring shape. Typical achievable for irregular parts is 10–25% above this."* Optionally compute a second, tighter empirical bound from the best single-sheet density achieved during search (`ceil(totalArea / (bestObservedSheetDensity × sheetArea))`) and show that as *"Realistic target."*

### C9. Kerf / gap / tessellation semantics must be defined exactly once

§8 correctly warns about double-counting but doesn't define the model. Here is the definition to implement and never deviate from:

```
C_effective  =  partGap  +  kerfWidth  +  2 × tessellationChordTolerance
```

- Each part's **collision contour** = exported contour offset outward by `C_effective / 2`.
- Part-to-part clearance then naturally equals `C_effective`. No second application anywhere.
- The **sheet's** inner-fit region = sheet rectangle inset by `edgeMargin + C_effective / 2`.
- **Exported DXF geometry is always the original, un-offset contour.** The offset exists only inside the collision model.
- `tessellationChordTolerance` is added so that arc/spline flattening error can never eat into real clearance. Suggest 0.05 mm chord tolerance, giving a 0.1 mm clearance reserve.

Kerf treatment note: for a router, `kerfWidth` = tool diameter and the toolpath is offset by `D/2` outside the contour — so the above is correct. For a laser, kerf is ~0.1–0.3 mm and the same model holds. Do **not** additionally shrink parts for kerf; your CAM does that.

### C10. Sheet inventory is a different problem than the one specified

§8 mentions "available sheet quantity where needed" and §5/§19 imply remnant reuse. Combined with variable sheet sizes, that is **variable-sized bin packing with a finite heterogeneous inventory**, which is strictly harder than the fixed-size unlimited-bin problem the rest of the brief describes.

**Resolution:** Phase 1 = **one sheet size, unlimited quantity**. Phase 2 = multiple stock sizes + remnant inventory. Do not let Phase 1 scope-creep into Phase 2; the optimizer design differs (the objective stops being "count sheets" and becomes "minimise stock cost").

### C11. Part-in-part nesting is genuinely unsafe for CNC routing

**Strong disagreement with enabling this by default.** On a router with vacuum hold-down or tabs:
- cutting the parent's internal hole releases the inner part, which can then be thrown by the tool;
- vacuum is lost through the hole once it's cut, destabilising the parent;
- cut-order becomes constrained (inner part must be fully cut and removed, or tabbed, before the parent hole is finished);
- tabs on the inner part sit inside a hole that may be too small for safe tab-cutting.

On a **laser** cutting acrylic or thin ply, part-in-hole is much safer — no hold-down loss, no tool deflection, gravity-drop into the honeycomb.

**Resolution:**
- Default **OFF** for router/MDF/plywood.
- Default **available but off** for laser/acrylic.
- When enabled, enforce guard rails: minimum bridge width between inner part and hole wall (suggest ≥ 3× material thickness), minimum inner part area (so it can carry tabs), and mark affected parts in the report with a cut-order warning.
- The UI toggle must state the risk, not just the option.

### C12. Reproducibility vs. worker parallelism

§32 requires reproducible runs; §23 requires multiple workers. Wall-clock-budgeted parallel search is inherently non-deterministic (thread interleaving changes the incumbent).

**Resolution:** Two budget modes internally.
- **Production mode:** wall-clock budget, N workers, non-deterministic — but the full run record (seed per worker, worker count, engine version, settings hash, incumbent trajectory) is stored so the *result* can be re-verified and inspected.
- **Reproducible mode:** iteration-count budget, fixed worker count, per-worker seeds derived deterministically from the master seed, deterministic merge order. Slower, bit-identical. Used for regression tests and for investigating a customer complaint.

Store the run record in the exported report either way. That satisfies "a bad customer nest must be reproducible" in the way that actually matters — you can replay it.

### C13. "Never output overlapping parts" needs a number

Floating-point geometry cannot guarantee exact non-overlap. **Resolution:** work in scaled integers (see §4), and define the acceptance criterion as *"no pair of collision contours overlaps by more than 0 integer units"* — which integer arithmetic makes exact — with the real-world safety margin coming from `C_effective`. The verifier checks integer contours, not floats.

### C14. "Never silently discard entities" vs. "clean safe defects"

**Resolution — the entity ledger.** Every DXF entity read gets exactly one disposition, recorded and shown:
`used-as-outer | used-as-hole | merged-into-contour | tessellated | ignored-layer | ignored-type | repaired-gap(≤ tol) | rejected-open | rejected-selfintersecting | duplicate-removed`
The import screen shows counts per disposition with a drill-down. Nothing is discarded without a line in this ledger. Anything in a `rejected-*` bucket blocks optimisation until the user acknowledges it.

### C15. Hosting gap — shared hosting cannot do what §3 Option B needs

If `woodaakar.in` is on shared cPanel-style hosting, you can serve the static SPA there, but:
- you likely **cannot set COOP/COEP response headers**, which kills WASM threading;
- you certainly cannot run a native Rust solver process.

**Resolution:** put the `/nest/` path behind a host that lets you control headers (Cloudflare Pages, Netlify, or a Cloudflare Worker in front of your existing origin). This is cheap and changes nothing for the customer. If you later want server-side Deep mode, that needs a small VPS (2–4 vCPU), not shared hosting. Budget for it as a real line item.

### C16. The commercial objective is subtly different from the stated one

Minor, worth stating: your actual cost function as a quoting business is `sheets consumed × sheet cost − recoverable remnant value + machine time`. Machine time rises with common-line loss and with part count, and fine rotations can increase cut time. The lexicographic sheet-first rule is the right approximation and I'd keep it — but if you ever see the optimizer trade a clean nest for a marginal utilisation gain, this is why, and a small machine-time term in the tertiary objective is the fix.

---

## STEP 2 — ENGINE SELECTION

### The decisive criterion

Your hardest requirement is **§14, fixed-K feasibility** — "can these parts fit in exactly K sheets?" Most nesting engines are built as *constructive* placers: sort parts, place them one by one, open a new bin when one won't fit. Such engines cannot answer the fixed-K question; they can only be run repeatedly and hoped at. That architecture is precisely what produced your "13 sheets, mostly empty" and "premature new sheet" failures.

One family of engines is built the other way round: **fix the container, allow temporary overlap, and use local search to drive total overlap to zero.** That is a feasibility solver by construction. Fixed-K is its native question, not a bolt-on.

### Candidate evaluation

| | **jagua-rs + sparrow** | **libnest2d** | **Deepnest / SVGnest** | **PackingSolver (irregular)** | **U-Nesting** | **SheetNest** |
|---|---|---|---|---|---|---|
| True shape | Yes, NFP-free quadtree CDE | Yes, NFP | Yes, NFP | Yes, polygons | Claimed | Yes |
| Holes in parts | Yes | Limited | Partial | Yes | Unclear | Yes |
| Part-in-hole | Not built in | No | No | Not built in | No | No |
| Multi-sheet | `bpp` feature in jagua-rs; **sparrow itself is strip-packing only** | Yes | Weak | Yes | Yes | Yes |
| Free/custom rotations | Arbitrary orientation sets | Discrete set | Discrete set | Discrete set | Discrete set | Discrete set |
| Core algorithm | Guided local search over a *fixed-container feasibility* problem + compression phase | Selection + first-fit/BL with optimiser hooks | Genetic algorithm over placement order | Heuristic tree search / beam search | BLF, NFP, GA, BRKGA, SA | In-house |
| Fixed-K native? | **Yes — this is its core loop** | No | No | Partly (bin-packing objective) | No | Partial (all-or-nothing last-sheet fold) |
| Browser/WASM | **Yes, shipped and proven** (sparrow/studio) | Awkward (C++/Boost/NLopt) | Electron desktop | Native C++ only | Native + Python | Windows .NET desktop |
| Maintenance | Active, academic + ongoing | Largely dormant since ~2020 | Community forks, irregular | Active | Very small project | Active but new |
| Licence | jagua-rs **MPL-2.0**, sparrow **MIT**, sparrow/studio **MIT** | **LGPL-3.0** | **Unverified** | Needs verification | Unverified | MIT |
| Deps of concern | Rust crates only | Boost, Clipper, NLopt | Clipper, boost, Electron | Possible MILP solvers (CBC/EPL, CPLEX) | Unknown | .NET |
| Integration effort | Medium — must build the bin-packing layer | High | High + wrong deployment model | High | Low but low quality | N/A (desktop) |

### Primary recommendation

**Adopt `jagua-rs` as the collision-detection engine and `sparrow`'s search architecture as the optimizer core; fork `sparrow-studio` as the frontend starting point; build a bin-packing / fixed-K layer on top.**

Why, specifically:

1. **Architectural fit on the one requirement that killed your previous attempts.** Sparrow decomposes nesting into a sequence of *feasibility* problems on a fixed container — items are temporarily allowed to collide and a local search separates them. Your §14 fixed-K search is not an extension of this; it *is* this. Every other candidate would require grafting fixed-K onto a constructive placer.
2. **The geometry is already solved and is fast.** jagua-rs's collision detection engine answers millions of queries per second and is separately published and peer-reviewed. You are not writing NFP code. §17's requirements are satisfied by a library, not by you.
3. **Browser deployment is already demonstrated.** sparrow/studio runs the Rust solver as WASM in Web Workers with SIMD and threaded builds and compatibility fallbacks, imports SVG/DXF, exposes rotations and clearance, and runs entirely locally with no server. That is 60–70% of your §3 Option A architecture, MIT-licensed, working today.
4. **Licence posture is the best available** (see §3 below).

### The gap you are buying — stated plainly

**sparrow solves strip packing, not bin packing.** It fits shapes into a strip of fixed width and minimises the length used. sparrow/studio's own documentation states that automatic allocation across multiple sheets and nesting inside holes are not supported.

So this recommendation is **not** "install sparrow and you're done." It is: *use the best available geometry engine and the best available search architecture, and write the multi-sheet/fixed-K layer yourself on top of them* — which is the ~20% of custom algorithm work that §1 explicitly permits when justified. jagua-rs has a `bpp` (Bin Packing Problem) feature flag that provides the multi-bin problem representation, so this layer is an extension, not a rewrite.

Estimated size of the custom layer: 3,000–6,000 lines of Rust (K-scheduler, cross-sheet moves, ruin-and-recreate operators, remnant/compaction objective, orientation-set generation). That is the honest number.

### Why the others are rejected

- **libnest2d** — LGPL-3.0, effectively dormant, constructive placement with no fixed-K concept, and a C++/Boost/NLopt stack that is painful to target at WASM. Its main claim to fame is being PrusaSlicer's arranger, which is a much easier problem than yours.
- **Deepnest / SVGnest** — genetic algorithm over *placement order*, which is a weak search for this objective and is the intellectual ancestor of the "bottom-left bias" you complained about in §18. Deepnest is a desktop Electron app; its licensing I could not verify in this session, which under your own §4 rule is disqualifying until proven otherwise. SVGnest is MIT and clean but single-bin and slow.
- **PackingSolver** — genuinely strong on rectangle/guillotine problems and its "bin packing with leftovers" objective is conceptually close to your remnant requirement. Its irregular module is the least mature part of the project, it is native C++ with no WASM story, and some configurations pull in MILP solvers with their own licences. Worth keeping as a **benchmark opponent**, not as the engine.
- **U-Nesting** — a small package advertising BLF, NFP, GA, BRKGA and SA. That feature list is a description of the exact class of homemade heuristic that already failed for you, and I could not establish its licence or provenance. No.
- **SheetNest** — MIT, active, and genuinely interesting *as a reference implementation and benchmark*: its release notes describe last-sheet folding and gathering leftover room into one open area, which is your §16 and §19 in a shipping product. But it is a Windows desktop .NET application, which is exactly the deployment model §2 forbids. **Use it to benchmark against, not to build on.**
- **Nest&Cut / PowerNest** — proprietary. No-go per your instruction.

### Cheap validation before you commit anything

**Do this before writing code.** sparrow/studio runs free in a browser with no account and no upload. Take your three worst real jobs — the 13-sheet one, the 32.7% one, the 4-sheet-with-two-parts one — reduce each to a single-sheet-width strip problem, and run them. If the sparrow core cannot beat your old layouts on *strip length for a fixed width*, this entire recommendation is wrong and we should know that in an afternoon rather than after six weeks. I would want to see this result before Milestone 1.

---

## STEP 3 — LICENCE AUDIT

**Verified on 14 September 2026 from upstream sources. This is documentary review, not legal advice.**

### Component verdicts

| Component | Declared licence | Verdict | Obligations |
|---|---|---|---|
| **jagua-rs** | MPL-2.0 | **CONDITIONAL GO** | See below — the one that needs real care |
| **sparrow** | MIT | **GO** | Preserve copyright + licence text |
| **sparrow-studio** | MIT | **GO** | Preserve copyright + licence text; note it already bundles third-party notices |
| **Clipper2** | Boost Software License 1.0 | **GO** | No notice required for binary distribution; include anyway |
| **libnest2d** | LGPL-3.0 | **NO-GO** | Static linking into a `.wasm` triggers §4 relinking obligations; satisfiable but ugly, and the engine isn't worth it |
| **Deepnest** | **Could not verify** | **NO-GO until verified** | Your own §4 rule applies |
| **PackingSolver** | Needs file-level verification | **CONDITIONAL** | Must confirm no MILP solver dependency is pulled into a distributed build |
| **U-Nesting** | Unverified | **NO-GO** | Unverifiable provenance |
| **Nest&Cut / PowerNest** | Proprietary | **NO-GO** | Per your instruction |

### The MPL-2.0 question — this is the important one

MPL-2.0 is **file-level copyleft**. Three facts determine your obligations:

1. **MPL has no SaaS/network clause.** Unlike AGPL, merely running MPL code on a server to provide a service does not trigger source disclosure. So a server-side deployment is unproblematic.
2. **But shipping a WASM bundle to a browser IS distribution.** Your preferred architecture (§3 Option A) puts jagua-rs-derived object code on every customer's machine. That is distribution of "Covered Software in Executable Form", and MPL §3.2 then requires that you inform recipients how to obtain the **Source Code Form of the Covered Software** — i.e. jagua-rs, including any modifications you made to its files.
3. **MPL explicitly permits combination with proprietary code in a "Larger Work."** Your own files, in your own crates, under your own licence, are not infected. This is the key difference from GPL/LGPL and the reason MPL is acceptable here.

**Practical compliance rules — make these non-negotiable engineering constraints:**

- **Never edit a jagua-rs source file in place inside your private repo.** If you need changes, maintain a **public fork** of jagua-rs with your patches and depend on it. Then compliance is: "here's the fork URL." Done.
- Prefer extending via your own crates (new files = your licence) over patching theirs (modified files = MPL).
- Ship an `OPEN_SOURCE_NOTICES` page at `woodaakar.in/nest/notices` containing: jagua-rs (MPL-2.0, link to source/fork), sparrow (MIT + copyright), sparrow-studio (MIT + copyright) if you fork it, Clipper2 (BSL-1.0), and the full Rust and npm dependency notices generated mechanically.
- Link to it from the nesting UI footer. Not buried.

### Mechanical dependency audit — required before launch

Root-level licences tell you nothing about the tree. Run these in CI and fail the build on violation:

```bash
# Rust
cargo install cargo-deny
cargo deny init
cargo deny check licenses bans sources advisories

# deny.toml — allow-list, not deny-list
# allow = ["MIT","Apache-2.0","BSD-2-Clause","BSD-3-Clause","ISC","Zlib","BSL-1.0","MPL-2.0","Unicode-3.0"]
# anything else fails the build

# JS
npx license-checker --production --failOn "GPL-2.0;GPL-3.0;AGPL-1.0;AGPL-3.0;SSPL-1.0;CC-BY-NC-4.0"
```

Commit the generated SBOM (`cargo sbom` / `npm sbom`, CycloneDX format) with every release. When someone asks what's in your product, you have an answer with a date on it.

### DXF parsing — a licence trap worth flagging now

`libdwg`/`libredwg` is **GPL-3.0**. Do not link it. For DXF (not DWG) you do not need it: DXF is a documented ASCII format and MIT-licensed JS parsers exist. Verify whichever you pick with the same `license-checker` gate. **Do not accept DWG in Phase 1** — the only good libraries are GPL or paid (Open Design Alliance membership), and that is exactly the unexpected-cost scenario §4 tells you to avoid.

### For a lawyer, before commercial production

1. Confirm that bundling MPL-2.0-derived object code with proprietary object code into a **single `.wasm` artifact** is treated as a "Larger Work" under MPL §3.3 rather than as creating a combined Covered Work. My reading is that it is permitted and that §3.2's source-availability notice is the full obligation, but this is the precise question a lawyer should sign off on, because it is the difference between "publish a link" and "publish your optimizer."
2. Trademark: "Nest&Cut" and "PowerNest" are third-party marks. Do not use them in comparative marketing copy without review.
3. If you ever adopt Option B (server-side), the **Digital Personal Data Protection Act, 2023** applies to customer geometry insofar as it is associated with an identifiable person. Customer DXFs are also their commercial IP. You need a written retention policy (I recommend: geometry deleted on job completion, hard TTL of 1 hour, no backups of the job store) and a privacy notice on the `/nest/` page.
4. Patent posture: MPL-2.0 and Apache-2.0 carry express patent grants; MIT and BSL do not. This is normal and low-risk for geometry algorithms, but note it.

### Overall verdict

**CONDITIONAL GO.** The stack is clean, the one copyleft component is file-level and combinable, and every obligation is satisfiable by publishing a fork link and a notices page. Conditions: (a) the fork discipline above, (b) `cargo-deny` + `license-checker` gates in CI before launch, (c) the `OPEN_SOURCE_NOTICES` page live at launch, (d) no DWG in Phase 1, (e) lawyer sign-off on the MPL/WASM bundling question.

---

## STEP 4 — ARCHITECTURE

### Phase 1 — all-browser

```
┌──────────────────────────────── woodaakar.in/nest/ (static SPA) ─────────────────────────────┐
│                                                                                               │
│  MAIN THREAD (React/TS)                                                                       │
│   ├─ Upload & entity ledger UI        ├─ Part list / quantities / grain flags                 │
│   ├─ Material & sheet setup           ├─ Rotation + depth selection (with advisories)         │
│   ├─ Live progress (§24)              └─ Sheet preview (SVG) — source view & nested view      │
│                                                                                               │
│  ── postMessage / SharedArrayBuffer ──────────────────────────────────────────────────────    │
│                                                                                               │
│  GEOMETRY WORKER                              COORDINATOR WORKER                              │
│   ├─ DXF parse (MIT TS parser)                 ├─ K schedule & time budgeting                 │
│   ├─ Arc/spline tessellation (chord tol)       ├─ Seed derivation per solver worker           │
│   ├─ Clipper2-WASM: union, offset,             ├─ Incumbent merge & diversification           │
│   │   simplify, self-intersection test         ├─ Progress events → main thread               │
│   ├─ Integer scaling (×10⁴ on mm)              └─ Cancellation                                │
│   ├─ Outer/hole association                        │                                          │
│   ├─ Shape-type dedup (hash canonical form)        ├──► SOLVER WORKER 1 ──┐                   │
│   └─ Orientation-set generation + symmetry fold    ├──► SOLVER WORKER 2   │ Rust→WASM         │
│                                                    └──► SOLVER WORKER N ──┘ (jagua-rs CDE     │
│                                                                              + sparrow core   │
│  VERIFIER (main thread, TypeScript — deliberately a SECOND implementation)    + woodaakar-bpp)│
│   ├─ pairwise integer overlap test  ├─ containment in usable region                           │
│   ├─ exact quantity reconciliation  └─ blocks export on any failure                           │
│                                                                                               │
│  EXPORT: nested DXF · JSON job report · quote summary · (PDF later)                           │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Deliberate design choices:**

- **Two independent geometry implementations.** The solver uses jagua-rs's CDE; the final verifier is a separate, simple, slow TypeScript integer-polygon checker. §29 demands independent verification, and independence means *not the same code*. If the fast engine has a bug, the slow checker catches it. Export is blocked on verifier failure — no override.
- **Integer coordinates throughout.** Scale mm × 10⁴ (0.1 µm resolution) into i64. Overlap becomes exactly decidable. A 3000 mm sheet is 3×10⁷ units — comfortable headroom in i64.
- **Shape-type deduplication before anything else.** 200 copies of 4 part types = 4 collision shapes, not 200. This is where most of §31's performance budget is won.
- **Nothing leaves the browser.** No upload, no telemetry on geometry. State this prominently in the UI — for a fabricator, "your drawings never leave your computer" is a selling point, not a footnote.

### Hosting

- Static build deployed to a host where you control response headers (Cloudflare Pages, or a Cloudflare Worker in front of the existing origin), serving `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` so `SharedArrayBuffer` and threaded WASM work.
- Feature-detect at boot: threads → SIMD → scalar fallback. Never show "Loading nesting engine…" without a timeout and an actionable error; that failure mode from your §1 list is a missing fallback path, not a mystery.
- Content-Security-Policy with `wasm-unsafe-eval`, no third-party script origins.

### Phase 2 — optional server tier (only if benchmarks justify it)

Rust `axum` service in a distroless container on a 2–4 vCPU VPS. Accepts **validated polygon JSON only** (never raw DXF — the parser stays in the browser, which removes the entire hostile-file-parsing attack surface from your server). Per-job limits: 30 MB payload, 20k vertices, 5k parts, 300 s CPU, 2 GB RSS, one job per connection. In-memory job store, 1-hour hard TTL, no disk persistence, no backups. Rate limit by IP and by session. The solver binary is never exposed; only the JSON API is.

### Job lifecycle

`imported → normalised → verified-input → configured → optimising(K=k, stage=…) → candidate → verified-output → exported`

Every transition is logged with timestamps into the run record. A job that fails output verification goes to `candidate → rejected` and the optimizer resumes rather than exporting.

---

## STEP 5 — OPTIMIZER CONFIGURATION

How each requirement maps onto the chosen engine. Where the engine lacks the capability, the extension is named and sized.

### 5.1 Sheet-count-first objective (§12)

**Not a weighted objective — a solver schedule.** The inner solver only ever answers one question: *given exactly K sheets, can all N items be placed feasibly?* Sheet count is decided by the outer loop, so it can never be traded away.

```
construct  →  K₀ (greedy, cardinal rotations, ~1-2 s)
loop:  attempt fixed-K feasibility at K = K₀-1 with budget b(K)
       if feasible → K₀ ← K-1, save layout, repeat
       if budget exhausted → stop, report "not found, not proven impossible"
finally:  polish at the final K (compaction + remnant consolidation)
```

### 5.2 Fixed-K feasibility (§14) — the core extension

This is where your custom Rust layer lives. Mechanism:

1. Represent the K sheets as K `Layout`s within a single jagua-rs `bpp` problem instance.
2. Place **all** items immediately, overlaps permitted. Each item carries a weighted overlap penalty against every other item and against the sheet boundary.
3. Run sparrow's separation local search: repeatedly select the item with the highest overlap cost and move it to the position (and orientation) minimising its cost, with guided-local-search weights escalating on persistently-overlapping pairs so the search escapes local minima.
4. **Extension required:** the move neighbourhood must include **cross-sheet relocation** (item moves from sheet i to sheet j). Sparrow's strip-packing version has no such move because it has one container. This is the single most important piece of new code.
5. Terminate on total overlap = 0 (feasible) or budget exhaustion (failed attempt).
6. **Hard invariant: the solver structurally cannot allocate sheet K+1.** There is no code path that creates a layout. Overflow manifests as residual overlap, i.e. a failed attempt. This directly kills the "premature new sheet" failure mode from §1.

### 5.3 Rotations (§9, §11) — orientation sets, computed once per part *type*

For each part type, build the legal orientation set:

```
mode → raw angle set
  0°                → {0}
  0/90              → {0, 90}
  cardinal          → {0, 90, 180, 270}
  15° / 5° / 3°     → {0, a, 2a, …} for a ∈ {15, 5, 3}
  custom a          → {0, a, 2a, …, k·a < 360}     ← feeds the actual sampler, not a label

then fold by symmetry:
  compute the contour's rotational symmetry order m (via turning-function autocorrelation,
  tolerance-aware) and reduce the set modulo 360/m
  → a square part with 3° increments collapses from 120 orientations to 30
  → a circular part collapses to 1

then apply constraints:
  grainConstraint ∩ set          (§C5)
  allowMirror → union with mirrored contour's set
```

Search strategy so that 120 orientations never means 120^N combinations:
- **Coarse-to-fine.** Exploration phase samples only cardinal orientations plus the top-K orientations ranked by a cheap score (bounding-box area, then convex-hull area, then contact potential against the current neighbourhood).
- **Contact-generated candidates.** During compression, propose orientations that align a long edge of the item with a long edge of a neighbour or the sheet — the angles that actually matter, generated from the geometry rather than enumerated.
- **Fine-angle polish last.** Only in the final phase, only on items with residual free space around them, only ±2 steps around the incumbent angle.
- **Lazy, LRU-cached** orientation shape representations, keyed by `(partTypeId, angleIndex)`.

The custom increment is therefore real: it changes the candidate sets that the sampler and the polish phase draw from. It is never cosmetic.

### 5.4 Sparse-sheet elimination (§16) — ruin-and-recreate, done properly

When a K-attempt at K−1 stalls, do **not** just lift the sparse sheet's items into frozen neighbours (your §16 explicitly rejects this, correctly). Instead:

1. Identify the lowest-utilisation sheet; remove all its items.
2. **Also ruin the receiving sheets**: for each, pick a random seed point and remove every item whose centroid lies within radius r (adaptive, targeting 15–30% of that sheet's items). This creates the large contiguous free regions that re-insertion actually needs.
3. Pool all removed items.
4. Re-insert with **regret-2 / regret-3** ordering (insert next the item whose second-best position is much worse than its best — the item that will hurt most if deferred), using the finer orientation set.
5. Accept/reject on total overlap; escalate GLS weights; repeat with different ruin seeds until budget exhausted.

### 5.5 Avoiding bottom-left bias (§18)

Bottom-left bias comes from a construction rule that always places at the lowest-leftmost feasible point. The sparrow architecture **does not have a construction rule** — items start scattered and are separated by local search — so the failure mode is structurally absent. To further diversify:
- randomised initial scatter per worker seed;
- different attractor fields per worker (centre, left-edge, corner, none);
- GRASP-style restricted candidate lists during re-insertion;
- a hull-growth penalty and a contact-length reward in the compression objective.

Explicitly **no skyline algorithm.** It is invalid for concave shapes and is one of the ways your prototypes produced the gaps you could see by eye.

### 5.6 Remnant consolidation (§19) and Strict/Free modes (§20)

After feasibility is reached at the final K, run **polish**:

1. **Directional compaction** — iteratively translate every item along a global direction field (default: toward −x, i.e. left) by the largest distance that keeps overlap at zero, sweeping in x-order; repeat with −y; repeat until no item moves more than ε. This is the multi-directional compaction of §21.
2. **Largest usable remnant** — on any sheet below 85% utilisation, compute the **maximum empty axis-aligned rectangle** over the occupancy raster (standard largest-rectangle-in-histogram scan, O(W·H)). Report its dimensions in the results and the report.
3. **Tertiary optimisation** — a short local search that accepts moves increasing that rectangle's area, subject to overlap staying at zero and K and utilisation being unchanged. Hard-bounded to ~10% of total budget.
4. **Isolated-part rule** (§19) — an item alone or nearly alone on a sheet is snapped to the nearest sheet corner unless doing so worsens the remnant rectangle.

**Strict mode** adds an x-centroid penalty term during compression and biases the compaction direction field strongly toward left-then-up. **Free mode** omits both. Both run; both are shown; if Strict costs a sheet, Strict is discarded for that job and the UI says *"Strict layout needed 3 sheets vs 2 — showing Free layout."*

### 5.7 Part-in-part (§6) — extension, default off

jagua-rs containers are polygons that may have holes. To allow part-in-hole, register a qualifying parent hole as an additional valid container region for the child, with the child's collision contour offset by `C_effective/2` as usual plus the bridge-width margin from §C11. Enabled only when: mode is on, machine profile is laser, hole area ≥ 4× child area, and minimum bridge ≥ 3× thickness. Affected parts are flagged in the report with a cut-order note.

### 5.8 Depth tiers (§22)

| | Workers | Budget | K-reduction | Rotations in exploration | Restarts | Polish |
|---|---|---|---|---|---|---|
| **FAST** | 1–2 | 3–5 s | none | cardinal only | 1 | compaction only |
| **BALANCED** | all−1 | 15–25 s | K→K−1, one level | cardinal + top-4 from set | 3 | full |
| **DEEP** | all−1 | 60–300 s | repeated to exhaustion | full orientation set, coarse-to-fine | 8+, diversified attractors | full + fine-angle |

Longer tiers **diversify**, they do not idle: more restarts, more attractor fields, more ruin seeds, wider orientation sets, deeper regret levels. That is checkable in the run record — the incumbent trajectory will show distinct restart events.

### 5.9 Final verification (§29)

Every candidate, before it is shown or exported:
- pairwise integer overlap of collision contours across each sheet → must be zero;
- every contour inside `sheet ∩ usable margin` → must hold;
- `Σ placed[type] == requested[type]` for every type → must hold exactly;
- holes correctly associated and not treated as material.

Failure → candidate rejected, logged with the offending pair, search resumes. Any part that cannot be placed at all is named explicitly in the results with the reason (§29, §30 fallback hierarchy: clean/simplify → robust re-representation → conservative collision model → convex hull → report unnestable).

---

## STEPS 6–9 — BUILD, TEST, DEPLOY PLAN

### Milestones

| | Deliverable | Acceptance |
|---|---|---|
| **M0** | Validation spike: your 3 worst real jobs run through sparrow/studio as strip problems | Sparrow core beats old layouts, or we stop and rethink |
| **M1** | Repo skeleton; `woodaakar-nest-core` Rust crate wrapping jagua-rs; CI with `cargo-deny` + `license-checker` gates; `OPEN_SOURCE_NOTICES` generated | Licence gates fail the build on a deliberately introduced GPL dep |
| **M2** | DXF import + entity ledger + contour/hole association + Clipper2 normalisation, in-browser | 20 real DXFs import with every entity accounted for |
| **M3** | Fixed-K feasibility solver with cross-sheet moves; WASM build; workers; progress + cancel | Solves benchmark instances; UI stays responsive; cancel is instant |
| **M4** | K-scheduler, ruin-and-recreate, orientation sets incl. custom increment, verifier | Regression corpus passes; custom increment provably changes search |
| **M5** | Polish, remnant rectangle, Strict/Free, depth tiers, results UI, DXF + report export | Old failure cases beaten on sheet count |
| **M6** | Deploy to `woodaakar.in/nest/`, notices page, privacy statement | Customer flow works end to end on desktop + mobile |

### Regression corpus (§33)

Every one of your named failures becomes a permanent test with a **hard assertion**, not an observation:
- `13-empty-sheets.dxf` → assert `sheets ≤ 5` (set the real threshold once we see the file)
- `three-sheets-32pct.dxf` → assert `sheets ≤ 2` or `utilisation ≥ 60%`
- `four-sheets-two-parts.dxf` → assert `sheets ≤ 3`
Plus synthetic coverage: convex, concave, asymmetric, tessellated circles, multi-hole parts, part-in-hole, near-tangent pairs, narrow necks, mixed quantities, 3° and custom increments, and malformed/hostile DXFs. Benchmarks record sheet count, utilisation, wall-clock, peak RSS, and verifier result, and CI fails on regression in any of them.

Also benchmark against **SheetNest** (MIT, free, Windows) on identical jobs. If a free desktop tool beats your optimizer, you need to know that from CI rather than from a customer.

### What I need from you to proceed

1. **Read-only access to the existing repo** (or a zip) — Step 6 cannot start without it.
2. **The three failing DXFs** plus 10–20 representative real jobs, with the sheet sizes, gaps and margins actually used.
3. **Hosting facts:** what `woodaakar.in` runs on today, and whether you can set response headers on `/nest/` or put Cloudflare in front.
4. **Machine facts:** router kerf (tool diameters in use), laser kerf, typical edge margin, typical part gap, and whether any of your stock is grain- or face-directional.
5. **A decision on part-in-hole** now that you've read §C11 — my recommendation is off for router, available for laser.

---

## §36 — WHERE I DISAGREE WITH THE BRIEF

Consolidated, so none of this is buried:

1. **3°/5° rotation is the wrong default** and will waste compute on most Woodaakar jobs. Keep it, default to 0/90, warn when geometry says it won't help. (§C6)
2. **Part-in-hole nesting is unsafe on a router** — hold-down loss, tool-thrown parts, cut-order constraints. Off by default for MDF/ply. (§C11)
3. **Strict column packing will cost yield on irregular parts.** Implement it as a compaction bias, not a placement constraint, and let it lose. (§C4)
4. **Your remnant requirement is only physically meaningful on partly-used sheets.** Scoped that way it doesn't conflict with sheet-count minimisation; scoped any wider, it does. (§C3)
5. **Browser-only optimisation is a real quality compromise**, mostly on mobile. Accept it for Fast/Balanced, keep the native path open for Deep. (§C1)
6. **FAST mode cannot be a nesting result.** Label it a preview or customers will quote off it. (§C2)
7. **A failed fixed-K attempt is not proof of infeasibility** and the UI must never imply it is. (§C7)
8. **You are missing a grain/face-direction requirement**, which will produce scrap parts on veneered stock regardless of how good the nest is. (§C5)
9. **Shared hosting probably can't deliver the architecture you want.** Budget for Cloudflare in front, and for a VPS if Deep goes server-side. (§C15)
10. **This will not be "install an engine and done."** No maintained open-source engine solves multi-sheet fixed-K irregular nesting out of the box. The recommendation gives you the best geometry engine and the best search architecture available under acceptable licences, and ~3–6k lines of genuinely necessary custom Rust on top. Anyone who tells you otherwise has not read §14.
