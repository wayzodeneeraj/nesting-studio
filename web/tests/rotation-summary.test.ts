import {test,expect} from 'vitest';
import {rotationSummary} from '../src/model';

test('rotation summaries describe unique orientations including equivalent and offset angles',()=>{
  // v2 schema: mode-based rotation (no explicit angles)
  expect(rotationSummary({mode:'fixed',allowMirror:false,grainLocked:false})).toBe('Fixed');
  expect(rotationSummary({mode:'halfTurn',allowMirror:false,grainLocked:false})).toBe('Half-turns');
  expect(rotationSummary({mode:'orthogonal',allowMirror:false,grainLocked:false})).toBe('Quarter-turns');
  expect(rotationSummary({mode:'incremental',stepDegrees:45,allowMirror:false,grainLocked:false})).toBe('8 angles');
  expect(rotationSummary({mode:'incremental',stepDegrees:15,allowMirror:false,grainLocked:false})).toBe('24 angles');
  // v2 schema: explicit angles via allowedAnglesDegrees (normalized angles)
  expect(rotationSummary({mode:'fixed',allowedAnglesDegrees:[0],allowMirror:false,grainLocked:false})).toBe('Fixed');
  expect(rotationSummary({mode:'fixed',allowedAnglesDegrees:[30,210],allowMirror:false,grainLocked:false})).toBe('Half-turns');
  expect(rotationSummary({mode:'fixed',allowedAnglesDegrees:[0,90,180,270],allowMirror:false,grainLocked:false})).toBe('Quarter-turns');
  expect(rotationSummary({mode:'fixed',allowedAnglesDegrees:[0,45,90],allowMirror:false,grainLocked:false})).toBe('3 angles');
  // grain-locked overrides all modes
  expect(rotationSummary({mode:'orthogonal',allowMirror:false,grainLocked:true})).toBe('Grain-locked (half-turns)');
});
