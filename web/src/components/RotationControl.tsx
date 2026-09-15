import {useState} from 'react';
import type {RotationConfig} from '../model';
import {rotationAngles} from '../model';

export default function RotationControl({rule,mixed,disabled,onChange}:{rule:RotationConfig;mixed:boolean;disabled:boolean;onChange:(config:RotationConfig)=>void}) {
  const presets=['[0]','[0,180]','[0,90,180,270]'];
  const angles = rotationAngles(rule);
  const value=JSON.stringify(angles);
  const [custom,setCustom]=useState(!mixed&&!presets.includes(value));
  const [text,setText]=useState(angles.join(', '));
  const degrees=text.split(',').map(s=>s.trim()===''?NaN:Number(s));
  const valid=degrees.every(Number.isFinite);
  function apply() {
    if(!disabled&&valid&&(mixed||JSON.stringify(degrees)!==value))onChange({mode:'fixed',allowedAnglesDegrees:degrees,allowMirror:false,grainLocked:false});
  }
  return <><label>Permitted rotations<select disabled={disabled} value={custom?'custom':mixed?'mixed':value} onChange={e=>{
    setCustom(e.target.value==='custom');
    if(e.target.value!=='custom'){
      const preset=e.target.value as string;
      if(preset==='[0]') onChange({mode:'fixed',allowMirror:false,grainLocked:false});
      else if(preset==='[0,180]') onChange({mode:'halfTurn',allowMirror:false,grainLocked:false});
      else if(preset==='[0,90,180,270]') onChange({mode:'orthogonal',allowMirror:false,grainLocked:false});
    }
  }}>
    {mixed&&<option value="mixed" disabled>Mixed</option>}
    <option value="[0]">Fixed 0°</option><option value="[0,180]">Half-turns · 0°, 180°</option><option value="[0,90,180,270]">Quarter-turns</option><option value="free">Free rotation</option><option value="custom">Custom degrees…</option>
  </select></label>
  {custom&&<label>Allowed degrees<input autoFocus disabled={disabled} value={text} aria-invalid={!valid} aria-describedby={!valid?'rotation-error':undefined} onChange={e=>setText(e.target.value)} onBlur={apply} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/>{!valid&&<small id="rotation-error" className="field-error" role="alert">Enter finite degrees separated by commas, such as 0, 180.</small>}</label>}</>;
}
