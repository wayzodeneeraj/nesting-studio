export type Point = [number, number];
export type Ring = Point[];

// Legacy v1 rotation format (deprecated but kept for migration)
export type RotationRule = { kind: 'discrete'; degrees: number[] } | { kind: 'continuous' };

// v2 rotation format
export type RotationMode = 'fixed' | 'halfTurn' | 'orthogonal' | 'incremental';
export type RotationConfig = {
  mode: RotationMode;
  stepDegrees?: number;           // required when mode is 'incremental'
  allowedAnglesDegrees?: number[]; // optional explicit list, overrides mode
  allowMirror: boolean;            // default false
  grainLocked: boolean;            // default false; enforced as halfTurn if true
};

export type MachineType = 'router' | 'laser';

export type Part = {
  id: string; name: string;
  source: { format: 'svg' | 'dxf' | 'sparrow' | 'drawn'; fileName?: string; entityId?: string };
  outer: Ring; holes: Ring[]; approximationToleranceMm: number; quantity: number;
  rotations: RotationConfig; preparationPosition: Point;
};

export type Settings = {
  solverPreset?: 'standard' | 'fast';
  materialWidthMm: number;
  sheetHeightMm: number;
  machineType: MachineType;
  partClearanceMm: number;    // minimum distance between parts
  edgeMarginMm: number;       // minimum distance from sheet boundary
  clearanceMm?: number;       // deprecated v1 field, kept for migration
  timeLimitSeconds: 10 | 30 | 60 | 120 | 300 | 600 | null;
};

export type Placement = { partId: string; copyIndex: number; xMm: number; yMm: number; angleDeg: number };
/** A document keeps the editable position of every demanded copy. */
export type Document = { name: string; parts: Part[]; settings: Settings; placements?: Placement[] };
export type Validation = { status: 'pending' | 'passed' | 'failed'; overlapAreaMm2: number;
  maxBoundaryViolationMm: number; minClearanceMm: number | null; errors: string[] };
export type SheetLayout = { sheetIndex: number; placements: Placement[]; utilization: number };
export type Result = { documentRevision: number; solverRevision: string; seed: string;
  elapsedSeconds: number; sheets: SheetLayout[]; validation: Validation };
export type Project = Document & { schemaVersion: 2; revision: number; result?: Result };

export const DEFAULT_SETTINGS: Settings = {
  materialWidthMm: 2440,
  sheetHeightMm: 1220,
  machineType: 'router',
  partClearanceMm: 3,
  edgeMarginMm: 10,
  timeLimitSeconds: null
};

export const SOLVER_REVISION = 'ed1c72cf244759e61f9881a93326e2e35e0514e6';
export const LIMITS = { copies: 500, verticesPerPart: 5000, verticesTotal: 100000, extent: 100000 };
export const POLICY = { linearMm: 1e-6, overlapMm2: 1e-8, angleDeg: 1e-4 };
// getRandomValues also works on HTTP LAN addresses, unlike randomUUID.
export function newPartId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function newPart(outer: Ring, name = 'Part'): Part {
  return { id: newPartId(), name, source: { format: 'drawn' }, outer, holes: [],
    approximationToleranceMm: 0, quantity: 1,
    rotations: { mode: 'halfTurn', allowMirror: false, grainLocked: false },
    preparationPosition: [0, 0] };
}
export function example(): Document {
  const shapes: Ring[] = [ [[0,0],[36,0],[36,12],[12,12],[12,38],[0,38]],
    [[0,0],[28,0],[36,20],[14,32],[0,20]], [[0,0],[38,0],[38,10],[26,10],[26,26],[12,26],[12,10],[0,10]],
    [[0,0],[30,0],[30,30],[0,30]] ];
  return { name: 'Workshop parts',
    settings: { materialWidthMm: 100, sheetHeightMm: 100, machineType: 'router',
      partClearanceMm: 0, edgeMarginMm: 0, timeLimitSeconds: null },
    parts: shapes.map((ring, i) => ({ ...newPart(ring, ['Bracket', 'Shield', 'Tab', 'Plate'][i]), quantity: 3,
      preparationPosition: [[0,0],[40,0],[0,42],[42,42]][i] as Point })) };
}

export function rotationSummary(config: RotationConfig): string {
  if (config.grainLocked) return 'Grain-locked (half-turns)';
  if (config.allowedAnglesDegrees) {
    const degrees = config.allowedAnglesDegrees;
    if (degrees.length === 1) return 'Fixed';
    if (degrees.length === 2 && Math.abs(degrees[1] - degrees[0] - 180) < 1e-6) return 'Half-turns';
    if (degrees.length === 4 && degrees.every((d,i) => Math.abs(d - i*90) < 1e-6)) return 'Quarter-turns';
    return `${degrees.length} angles`;
  }
  switch (config.mode) {
    case 'fixed': return 'Fixed';
    case 'halfTurn': return 'Half-turns';
    case 'orthogonal': return 'Quarter-turns';
    case 'incremental': return `${Math.round(360 / (config.stepDegrees ?? 90))} angles`;
  }
}

/** Convert RotationConfig to explicit angle list per spec §2c */
export function rotationAngles(config: RotationConfig): number[] {
  if (config.grainLocked) return [0, 180];
  if (config.allowedAnglesDegrees) return config.allowedAnglesDegrees;
  switch (config.mode) {
    case 'fixed': return [0];
    case 'halfTurn': return [0, 180];
    case 'orthogonal': return [0, 90, 180, 270];
    case 'incremental': {
      const step = config.stepDegrees ?? 90;
      const angles: number[] = [];
      for (let a = 0; a < 360; a += step) angles.push(a);
      return angles;
    }
  }
}
