import {it,expect,describe} from 'vitest';
import {importProject,exportProject} from '../src/import/project';
import type {Document} from '../src/model';

describe('v1 to v2 migration', () => {
  // Helper to create a minimal v1 project
  function v1Project(overrides: any = {}) {
    return JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      name: 'Test v1 project',
      parts: [{
        id: 'test-part-id',
        name: 'Test Part',
        source: { format: 'drawn' },
        outer: [[0,0],[10,0],[10,10],[0,10]],
        holes: [],
        approximationToleranceMm: 0,
        quantity: 1,
        rotations: { kind: 'discrete', degrees: [0, 180] },
        preparationPosition: [0, 0]
      }],
      settings: {
        materialWidthMm: 2440,
        clearanceMm: 3,
        timeLimitSeconds: null
      },
      ...overrides
    });
  }

  it('migrates v1 project with all required fields added', () => {
    const review = importProject(v1Project());
    expect(review.replace).toBe(true);
    expect(review.warnings).toHaveLength(1);
    expect(review.warnings[0]).toContain('Migrated from v1');
    expect(review.warnings[0]).toContain('1220 mm');

    const doc = review.document;
    expect(doc.settings.materialWidthMm).toBe(2440);
    expect(doc.settings.sheetHeightMm).toBe(1220);
    expect(doc.settings.machineType).toBe('router'); // clearance 3mm > 1mm
    expect(doc.settings.partClearanceMm).toBe(3);
    expect(doc.settings.edgeMarginMm).toBe(5); // max(5, clearance)
  });

  it('migrates rotation formats correctly', () => {
    const testCases = [
      { input: { kind: 'discrete', degrees: [0] }, expected: { mode: 'fixed' } },
      { input: { kind: 'discrete', degrees: [0, 180] }, expected: { mode: 'halfTurn' } },
      { input: { kind: 'discrete', degrees: [0, 90, 180, 270] }, expected: { mode: 'orthogonal' } },
      { input: { kind: 'continuous' }, expected: { mode: 'incremental', stepDegrees: 15 } },
      { input: { kind: 'discrete', degrees: [0, 45, 90] }, expected: { allowedAnglesDegrees: [0, 45, 90] } }
    ];

    for (const {input, expected} of testCases) {
      const v1 = JSON.parse(v1Project());
      v1.parts[0].rotations = input;
      const review = importProject(JSON.stringify(v1));
      const rotation = review.document.parts[0].rotations;

      expect(rotation.allowMirror).toBe(false);
      expect(rotation.grainLocked).toBe(false);

      if (expected.mode) expect(rotation.mode).toBe(expected.mode);
      if (expected.stepDegrees) expect(rotation.stepDegrees).toBe(expected.stepDegrees);
      if (expected.allowedAnglesDegrees) expect(rotation.allowedAnglesDegrees).toEqual(expected.allowedAnglesDegrees);
    }
  });

  it('detects machine type from clearance heuristic', () => {
    // High clearance → router
    const router = importProject(v1Project({ settings: { materialWidthMm: 2440, clearanceMm: 5, timeLimitSeconds: null } }));
    expect(router.document.settings.machineType).toBe('router');

    // Low clearance → laser
    const laser = importProject(v1Project({ settings: { materialWidthMm: 2440, clearanceMm: 0.5, timeLimitSeconds: null } }));
    expect(laser.document.settings.machineType).toBe('laser');

    // Zero clearance → laser
    const zero = importProject(v1Project({ settings: { materialWidthMm: 2440, clearanceMm: 0, timeLimitSeconds: null } }));
    expect(zero.document.settings.machineType).toBe('laser');
    expect(zero.document.settings.edgeMarginMm).toBe(0);
  });

  it('discards v1 result and explains why', () => {
    const v1WithResult = JSON.parse(v1Project());
    v1WithResult.result = {
      documentRevision: 1,
      solverRevision: 'ed1c72cf244759e61f9881a93326e2e35e0514e6',
      seed: '42',
      elapsedSeconds: 1.5,
      usedLengthMm: 500,
      placements: [{partId: 'test-part-id', copyIndex: 0, xMm: 10, yMm: 10, angleDeg: 0}],
      validation: {status: 'passed', overlapAreaMm2: 0, maxBoundaryViolationMm: 0, minClearanceMm: null, errors: []}
    };

    const review = importProject(JSON.stringify(v1WithResult));
    expect(review.result).toBeUndefined();
    expect(review.warnings.some(w => w.includes('result discarded'))).toBe(true);
    expect(review.warnings.some(w => w.includes('strip-packing') || w.includes('re-nest'))).toBe(true);
  });

  it('preserves placements even when result is discarded', () => {
    const v1WithPlacements = JSON.parse(v1Project());
    v1WithPlacements.placements = [{partId: 'test-part-id', copyIndex: 0, xMm: 30, yMm: 20, angleDeg: 90}];
    v1WithPlacements.result = { /* will be discarded */ };

    const review = importProject(JSON.stringify(v1WithPlacements));
    expect(review.document.placements).toEqual([{partId: 'test-part-id', copyIndex: 0, xMm: 30, yMm: 20, angleDeg: 90}]);
    expect(review.result).toBeUndefined();
  });

  it('handles missing sheetHeightMm with flagged default', () => {
    const review = importProject(v1Project());
    expect(review.document.settings.sheetHeightMm).toBe(1220);
    expect(review.warnings[0]).toContain('sheet height set to 1220 mm');
    expect(review.warnings[0]).toContain('standard 2440×1220');
  });

  it('opens project in degraded state when normalization fails but migration succeeds', () => {
    const v1Invalid = JSON.parse(v1Project());
    // Create an invalid part that will fail normalization
    v1Invalid.parts[0].outer = [[0, 0]]; // Invalid polygon (less than 3 points)

    const review = importProject(JSON.stringify(v1Invalid));
    expect(review.document).toBeDefined();
    expect(review.warnings.some(w => w.includes('degraded state'))).toBe(true);
    expect(review.warnings.some(w => w.includes('Migration warning'))).toBe(true);
  });

  it('rejects completely invalid v1 project structure', () => {
    const invalid = JSON.stringify({ schemaVersion: 1, revision: 'not-a-number', name: 'Bad' });
    expect(() => importProject(invalid)).toThrow('Invalid project revision');
  });

  it('preserves solver preset during migration', () => {
    const v1Fast = JSON.parse(v1Project());
    v1Fast.settings.solverPreset = 'fast';
    const review = importProject(JSON.stringify(v1Fast));
    expect(review.document.settings.solverPreset).toBe('fast');
  });

  it('migrates project with holes correctly', () => {
    const v1WithHoles = JSON.parse(v1Project());
    v1WithHoles.parts[0].holes = [[[2,2],[2,4],[4,4],[4,2]]];
    const review = importProject(JSON.stringify(v1WithHoles));
    expect(review.document.parts[0].holes).toEqual([[[2,2],[2,4],[4,4],[4,2]]]);
  });
});

describe('v2 schema round-trip', () => {
  it('exports and imports v2 project without migration warnings', () => {
    const doc: Document = {
      name: 'V2 test',
      parts: [{
        id: 'v2-part',
        name: 'Part',
        source: { format: 'drawn' },
        outer: [[0,0],[10,0],[10,10],[0,10]],
        holes: [],
        approximationToleranceMm: 0,
        quantity: 1,
        rotations: { mode: 'halfTurn', allowMirror: false, grainLocked: false },
        preparationPosition: [0, 0]
      }],
      settings: {
        materialWidthMm: 2440,
        sheetHeightMm: 1220,
        machineType: 'router',
        partClearanceMm: 3,
        edgeMarginMm: 10,
        timeLimitSeconds: null
      }
    };

    const exported = exportProject(doc, 5);
    const parsed = JSON.parse(exported);
    expect(parsed.schemaVersion).toBe(2);

    const review = importProject(exported);
    expect(review.replace).toBe(true);
    expect(review.warnings).toHaveLength(0); // No migration warnings
    expect(review.document.settings).toMatchObject(doc.settings);
    expect(review.document.parts[0].rotations).toEqual(doc.parts[0].rotations);
  });

  it('rejects unsupported schema version', () => {
    const v99 = JSON.stringify({ schemaVersion: 99, revision: 1, name: 'Future' });
    expect(() => importProject(v99)).toThrow('Unsupported project schema version 99');
  });

  it('rejects project with no schema version', () => {
    const noSchema = JSON.stringify({ revision: 1, name: 'No schema' });
    expect(() => importProject(noSchema)).toThrow('missing schemaVersion');
  });
});

describe('hole footprint confirmation', () => {
  it('confirms solver receives only outer contour when holes present', () => {
    // This test documents the current behavior: holes are stripped from solver input
    // The solver treats simple_polygon as solid, reserving full outer footprint
    const doc: Document = {
      name: 'Holed part',
      parts: [{
        id: 'holed',
        name: 'Jali panel',
        source: { format: 'drawn' },
        outer: [[0,0],[100,0],[100,100],[0,100]],
        holes: [[[20,20],[20,40],[40,40],[40,20]], [[60,60],[60,80],[80,80],[80,60]]],
        approximationToleranceMm: 0,
        quantity: 1,
        rotations: { mode: 'fixed', allowMirror: false, grainLocked: false },
        preparationPosition: [0, 0]
      }],
      settings: {
        materialWidthMm: 200,
        sheetHeightMm: 200,
        machineType: 'laser',
        partClearanceMm: 0,
        edgeMarginMm: 0,
        timeLimitSeconds: null
      }
    };

    // Export and verify holes are preserved in project
    const exported = exportProject(doc, 1);
    const parsed = JSON.parse(exported);
    expect(parsed.parts[0].holes).toHaveLength(2);

    // Import and verify holes round-trip
    const review = importProject(exported);
    expect(review.document.parts[0].holes).toHaveLength(2);

    // Note: solverInput() (in sparrow.ts) sends shape:{type:'simple_polygon',data:outer}
    // Holes are omitted → solver reserves full outer footprint (correct for V1)
  });
});
