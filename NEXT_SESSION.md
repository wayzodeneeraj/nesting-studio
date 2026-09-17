# Next Session - Schema v2 Migration Continuation

**Date:** 2026-09-15  
**Status:** Schema v2 implementation complete, TypeScript passes, but test suite has failures  
**Branch:** `main` (local, NOT pushed)  
**Last commit:** `8ba5b71` - "Schema v2 complete: multi-sheet fields, migration, all errors fixed"

⚠️ **DO NOT PUSH** - Test suite is not fully passing

---

## What Was Completed ✅

### 1. Schema v2 Implementation - COMPLETE
- ✅ Added `sheetHeightMm`, `machineType`, `partClearanceMm`, `edgeMarginMm` to Settings
- ✅ Replaced `RotationRule` with `RotationConfig` (mode-based rotation with grain-lock support)
- ✅ Bumped `schemaVersion` from 1 to 2
- ✅ Added helper functions: `rotationAngles()`, `rotationSummary()`
- ✅ Updated all core files to use new types

### 2. V1→V2 Migration - COMPLETE
- ✅ Automatic migration in `importProject()`
- ✅ Machine type defaults to 'router' with **explicit warning** (no silent inference)
- ✅ Continuous rotation → incremental 15° with **named-part warnings**
- ✅ Sheet height defaults to 1220mm with verification prompt
- ✅ Migration preserves placements but discards v1 results (strip→sheet incompatible)
- ✅ Graceful degraded-state handling

### 3. Code Quality - COMPLETE
- ✅ **TypeScript:** `npm run typecheck` passes with ZERO errors
- ✅ Updated files:
  - `web/src/model.ts` - New types and helpers
  - `web/src/import/project.ts` - Migration logic
  - `web/src/import/sparrow.ts` - Updated for v2
  - `web/src/App.tsx` - Schema v2 throughout
  - `web/src/components/RotationControl.tsx` - New rotation UI
  - `web/src/components/ShapeLibrary.tsx` - Updated rotation display
  - `web/src/geometry/normalize.ts` - v2 validation
  - `web/src/geometry/validate.ts` - Uses `rotationAngles()`
  - `web/src/geometry/placements.ts` - Rotation handling
  - `web/src/import/library.ts` - Clearance handling

### 4. Hole Footprint Behavior - CONFIRMED ✅
**Question:** When holes are omitted from solver input, does the solver reserve the full outer footprint?

**Answer:** YES ✅
- Current code sends `shape:{type:'simple_polygon',data:p.outer}` (no holes)
- jagua-rs treats `simple_polygon` as a solid shape
- Collision detection is against the filled outer contour
- Parts cannot nest inside the outer boundary
- **This correctly reserves the full outer footprint** (matches V1 spec requirement)

---

## What Is Broken ❌

### Test Suite Status
```
TypeScript:  ✅ PASSES (0 errors)
Tests:       ❌ FAILS (42 failed / 137 total)
Test Files:  ❌ 6 failed / 19 total
```

### Passing Tests ✅
- ✅ `migration.test.ts` (14/14) - Core v1→v2 migration tests
- ✅ `project.test.ts` (9/9) - Project import/export with v2 schema
- ✅ `library.test.ts` (3/3) - Shape library with new rotation format
- ✅ 10 other test files passing

### Failing Tests ❌

#### 1. datasets.test.ts (20 failures)
**Cause:** SHA256 hash mismatches on example JSON files

**Why:** `importSparrow()` now adds `sheetHeightMm: 2440` to imported settings (line 49 in `import/sparrow.ts`):
```typescript
settings:{
  ...DEFAULT_SETTINGS,
  materialWidthMm:number(input.strip_height)*scale,
  sheetHeightMm: 2440  // ← NEW, changes file structure
}
```

**Impact:** All 20+ bundled example files (albano.json, blaz1.json, dagli.json, etc.) now have different SHA256 hashes because their imported structure changed.

**Fix Options:**
- A) Regenerate expected hashes in `datasets.ts` catalog
- B) Remove `sheetHeightMm` from `importSparrow()` and let it come from `DEFAULT_SETTINGS`
- C) Update test to compare structure, not hashes

#### 2. solver-queue.test.ts (multiple failures)
**Likely cause:** Result type or Settings type changes affecting worker message contracts

**Example failure:**
```
expected undefined to match object { documentRevision: 8, usedLengthMm: 20 }
```

**Fix needed:** Update worker/solver integration tests for v2 schema

#### 3. auto-termination.spec.ts, geometry.test.ts, units.spec.ts
**Likely cause:** Integration tests that create test projects need v2 schema

**Fix needed:** Update test project creation to use schemaVersion: 2 and new Settings fields

---

## Commits Not Pushed

```
8ba5b71 Schema v2 complete: multi-sheet fields, migration, all errors fixed
4cd1505 Schema v2: Add multi-sheet fields and v1→v2 migration (WIP)
4c61b14 Add multi-sheet specification and repository discovery findings
```

**Warning:** First commit (`4cd1505`) has broken TypeScript - it was an intermediate WIP commit that should have been squashed before final commit.

---

## Options for Next Session

### Option A: Fix All Tests (Recommended for Clean Merge)
**Effort:** 1-2 hours  
**Steps:**
1. Fix `datasets.test.ts`:
   - Option A1: Regenerate SHA256 hashes for all 20+ example files
   - Option A2: Change test to validate structure instead of hash
2. Fix `solver-queue.test.ts` - Update result/settings handling in tests
3. Fix integration tests - Update test project factories for v2
4. Run full suite until green
5. Squash the three commits into one clean commit
6. Push to remote

**Pros:** Clean, complete, no known issues  
**Cons:** More time investment

### Option B: Skip Dataset Hash Tests for Now
**Effort:** 30-60 minutes  
**Steps:**
1. Mark `datasets.test.ts` as `.skip` or comment out hash checks
2. Fix only `solver-queue.test.ts` and integration tests
3. Create issue to regenerate dataset hashes later
4. Push with note about skipped tests

**Pros:** Faster, focuses on critical tests  
**Cons:** Leaves known failing test (must be fixed before release)

### Option C: Revert and Apply More Incrementally
**Effort:** 2-3 hours (redo work)  
**Steps:**
1. `git reset --hard 4c61b14` (revert to before schema changes)
2. Apply schema changes file-by-file with tests passing at each step
3. Update all tests as you go
4. Push only when everything green

**Pros:** Clean history, tests never broken  
**Cons:** Redoes completed work, slower

---

## Key Files Modified (Uncommitted Changes)

Currently all changes are committed locally. Working tree is clean:
```
git status: On branch main, nothing to commit, working tree clean
```

---

## Important Notes

### Migration Corrections Applied ✅
Per user feedback, these corrections were made:

1. **No silent machine-type inference** ✅
   - Always defaults to 'router'
   - Explicit warning: "Machine type set to 'router' (default). Verify and change to 'laser' if needed"
   - Never infers from clearance value

2. **Continuous rotation warnings name parts** ✅
   - Warning text: `Part "{name}": continuous rotation mapped to 15° increments (24 angles). Original continuous rotation is not representable in v2 schema.`
   - User sees which parts are affected

3. **Typecheck before commit** ✅
   - Lesson learned: Never commit broken TypeScript
   - Current state: TypeScript passes, but tests don't
   - Should have fixed tests before committing

### Schema Design Decisions

**DEFAULT_SETTINGS** now:
```typescript
{
  materialWidthMm: 2440,     // Was: 1000
  sheetHeightMm: 1220,       // NEW - standard sheet
  machineType: 'router',     // NEW - explicit default
  partClearanceMm: 3,        // Was: clearanceMm
  edgeMarginMm: 10,          // NEW
  timeLimitSeconds: null
}
```

**RotationConfig** structure:
```typescript
{
  mode: 'fixed' | 'halfTurn' | 'orthogonal' | 'incremental',
  stepDegrees?: number,           // for 'incremental'
  allowedAnglesDegrees?: number[], // explicit override
  allowMirror: boolean,
  grainLocked: boolean
}
```

---

## Quick Commands

```bash
# Check TypeScript (should pass)
npm run typecheck

# Run specific test file
npm test -- migration.test.ts --run
npm test -- datasets.test.ts --run

# Run all tests
npm test -- --run

# See commit history
git log --oneline -5

# See what's not pushed
git log origin/main..HEAD

# If deciding to push anyway (NOT RECOMMENDED):
git push  # Will push 3 commits including WIP one

# If deciding to squash first:
git rebase -i HEAD~3  # Mark first two as 'fixup'
```

---

## Recommended Next Steps

1. **Decide on Option A, B, or C** (see above)
2. **Fix failing tests** per chosen option
3. **Verify full test suite passes:** `npm test -- --run`
4. **Verify TypeScript:** `npm run typecheck`
5. **Squash commits if needed:** `git rebase -i HEAD~3`
6. **Push to remote:** `git push`

---

## Questions to Answer

1. **Should dataset hash tests be regenerated or restructured?**
   - Current: Tests check SHA256 of JSON files
   - Problem: Adding `sheetHeightMm` changed all hashes
   - Decision needed: Regenerate hashes or change test approach?

2. **Should DEFAULT_SETTINGS have materialWidthMm: 2440 or 1000?**
   - Changed from 1000 to 2440 (standard sheet width)
   - Affects new projects and imports
   - May affect some tests expecting 1000

3. **Should the three commits be squashed into one?**
   - Current: Discovery + WIP + Final
   - WIP commit has broken TypeScript (bad)
   - Recommend: Squash into 2 commits (Discovery + Complete Schema v2)

---

**End of status. Resume when ready.**
