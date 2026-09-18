import type {Document,Project,Result,RotationConfig,RotationRule,MachineType} from '../model';
import {normalizeDocument} from '../geometry/normalize';
import {validate} from '../geometry/validate';
import {documentPlacements,placementKey,samePlacement,withDocumentPlacements} from '../geometry/placements';
import type {ImportReview} from './sparrow';

// Legacy v1 project types for migration
type LegacyV1Settings = {
  solverPreset?: 'standard' | 'fast';
  materialWidthMm: number;
  clearanceMm: number;
  timeLimitSeconds: 10 | 30 | 60 | 120 | 300 | 600 | null;
};
type LegacyV1Part = {
  id: string; name: string;
  source: { format: 'svg' | 'dxf' | 'sparrow' | 'drawn'; fileName?: string; entityId?: string };
  outer: [number, number][]; holes: [number, number][][];
  approximationToleranceMm: number; quantity: number;
  rotations: RotationRule;
  preparationPosition: [number, number];
};
type LegacyV1Project = {
  schemaVersion: 1;
  revision: number;
  name: string;
  parts: LegacyV1Part[];
  settings: LegacyV1Settings;
  placements?: { partId: string; copyIndex: number; xMm: number; yMm: number; angleDeg: number }[];
  result?: any; // will be discarded
};

/** Migrate v1 rotation format to v2 */
function migrateRotation(legacy: RotationRule, partName: string, warnings: string[]): RotationConfig {
  if (legacy.kind === 'continuous') {
    // Continuous rotation cannot be represented exactly
    warnings.push(`Part "${partName}": continuous rotation mapped to 15° increments (24 angles). Original continuous rotation is not representable in v2 schema.`);
    return { mode: 'incremental', stepDegrees: 15, allowMirror: false, grainLocked: false };
  }
  const degrees = [...new Set(legacy.degrees.map(d => ((d % 360) + 360) % 360))].sort((a,b) => a-b);
  if (degrees.length === 1 && degrees[0] === 0) return { mode: 'fixed', allowMirror: false, grainLocked: false };
  if (degrees.length === 2 && degrees[0] === 0 && degrees[1] === 180) return { mode: 'halfTurn', allowMirror: false, grainLocked: false };
  if (degrees.length === 4 && degrees.every((d,i) => d === i*90)) return { mode: 'orthogonal', allowMirror: false, grainLocked: false };
  // Custom angle set - preserve exactly
  return { mode: 'fixed', allowedAnglesDegrees: degrees, allowMirror: false, grainLocked: false };
}

/** Migrate v1 project to v2 schema */
function migrateFromV1(v1: LegacyV1Project): { document: Document; warnings: string[] } {
  const warnings: string[] = [];

  // Machine type defaults to router - user must verify
  const machineType: MachineType = 'router';
  warnings.push(`Machine type set to 'router' (default). Verify and change to 'laser' if needed - this affects kerf and clearance defaults.`);

  // Default sheet height - standard 2440×1220 sheet
  const sheetHeightMm = 1220;
  warnings.push(`Sheet height set to ${sheetHeightMm} mm (standard 2440×1220 sheet). Strip width (${v1.settings.materialWidthMm} mm) preserved as sheet width. Verify sheet dimensions before nesting.`);

  // Map clearance to part clearance and edge margin
  const partClearanceMm = v1.settings.clearanceMm;
  const edgeMarginMm = v1.settings.clearanceMm > 0 ? Math.max(5, v1.settings.clearanceMm) : 10;

  const settings = {
    solverPreset: v1.settings.solverPreset,
    materialWidthMm: v1.settings.materialWidthMm,
    sheetHeightMm,
    machineType,
    partClearanceMm,
    edgeMarginMm,
    timeLimitSeconds: v1.settings.timeLimitSeconds,
  };

  const parts = v1.parts.map(p => ({
    id: p.id,
    name: p.name,
    source: p.source,
    outer: p.outer,
    holes: p.holes,
    approximationToleranceMm: p.approximationToleranceMm,
    quantity: p.quantity,
    rotations: migrateRotation(p.rotations, p.name, warnings),
    preparationPosition: p.preparationPosition,
  }));

  // Placements are preserved, but result is discarded (strip layout cannot be reinterpreted as sheet layout)
  if (v1.result) {
    warnings.push('Saved strip-packing result discarded: cannot reinterpret strip layout as fixed-sheet layout. Parts and settings preserved; re-nest required.');
  }

  const document = { name: v1.name, parts, settings, placements: v1.placements };
  return { document, warnings };
}

export function importProject(text:string):ImportReview {
  const data=JSON.parse(text) as any;
  if(!data||typeof data.schemaVersion!=='number')throw Error('Invalid project: missing schemaVersion.');

  // Handle v1 migration
  if (data.schemaVersion === 1) {
    const v1 = data as LegacyV1Project;
    if(!Number.isSafeInteger(v1.revision)||v1.revision<0)throw Error('Invalid project revision.');
    const { document, warnings } = migrateFromV1(v1);
    try {
      const normalized = normalizeDocument(document, true);
      return { document: normalized, warnings, replace: true };
    } catch (error) {
      // Migration succeeded but normalization failed - return degraded state
      warnings.push(`Migration warning: ${error instanceof Error ? error.message : String(error)}. Project opened in degraded state; some features may not work.`);
      return { document, warnings, replace: true };
    }
  }

  // Handle v2 (current)
  if (data.schemaVersion !== 2) throw Error(`Unsupported project schema version ${data.schemaVersion}. This app reads versions 1 and 2 only.`);

  const project = data as Project;
  if(!Number.isSafeInteger(project.revision)||project.revision<0)throw Error('Invalid project revision.');
  const document=normalizeDocument({name:project.name,parts:project.parts,settings:project.settings,placements:project.placements},true);
  const warnings:string[]=[];let result:Result|undefined;
  if(project.result!==undefined) {
    try {
      if(!document.parts.length)throw Error('Empty projects cannot contain a layout.');
      const saved=project.result;
      if(!saved||saved.documentRevision!==project.revision||typeof saved.solverRevision!=='string'||!/^[a-f0-9]{40}(?:\+[a-z0-9.-]{1,64})?$/i.test(saved.solverRevision)||typeof saved.seed!=='string'||!/^\d{1,20}$/.test(saved.seed)||BigInt(saved.seed)>2n**64n-1n||!Number.isFinite(saved.elapsedSeconds)||saved.elapsedSeconds<0)throw Error('Invalid or mismatched result provenance.');
      // A stored badge has no authority. Check the placements against this file's
      // normalized geometry and the current numeric policy in the worker.
      // Handle both old format (usedLengthMm/placements) and new format (sheets)
      const savedAny = saved as any;
      const candidate:Result = 'sheets' in savedAny ? savedAny : {
        documentRevision:savedAny.documentRevision,solverRevision:savedAny.solverRevision,seed:savedAny.seed,
        elapsedSeconds:savedAny.elapsedSeconds,
        sheets:[{sheetIndex:0,placements:savedAny.placements,utilization:0}],
        validation:savedAny.validation
      };
      const validation=validate(document,candidate);
      if(validation.status!=='passed')throw Error(validation.errors.join(' '));
      if(project.placements!==undefined) {
        const draft=documentPlacements(document),checked=new Map(candidate.sheets.flatMap(s=>s.placements).map(placement=>[placementKey(placement),placement]));
        if(draft.length!==checked.size||draft.some(placement=>!samePlacement(placement,checked.get(placementKey(placement))))) throw Error('Saved result does not match the explicit copy positions in this project.');
      }
      result={...candidate,validation};warnings.push('Saved result rechecked successfully.');
    }catch(error){warnings.push(`Saved result was discarded: ${error instanceof Error?error.message:String(error)} The parts and settings can still be loaded.`);}
  }
  const allPlacements = result?.sheets.flatMap(s => s.placements);
  return {document:withDocumentPlacements(document,allPlacements),result,warnings,replace:true};
}

export function exportProject(document:Document,revision:number,result?:Result):string {
  const doc=normalizeDocument({name:document.name,parts:document.parts,settings:document.settings,placements:document.placements},true);
  if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid project revision.');
  if(result&&result.documentRevision!==revision)throw Error('The result belongs to an older document.');
  if(result) {
    if(!doc.parts.length)throw Error('Empty projects cannot contain a layout.');
    result={...result,validation:validate(doc,result)};
    if(result.validation.status!=='passed')throw Error(`Saved layout failed validation: ${result.validation.errors.join(' ')}`);
  }
  const text=JSON.stringify({...doc,schemaVersion:2,revision,...(result?{result}: {})} satisfies Project,null,2);
  if(new Blob([text]).size>10*1024*1024)throw Error('Project exceeds the 10 MiB file limit. Reduce geometry or metadata before saving.');
  const checked=importProject(text);
  if(result&&!checked.result)throw Error(checked.warnings.join(' '));
  return text;
}
