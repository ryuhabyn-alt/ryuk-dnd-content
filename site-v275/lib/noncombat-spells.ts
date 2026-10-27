import {recoverAfterHealing} from './recovery-rules';
import {advanceActionTime} from './living-world/action-time';
import type {Campaign} from './campaign';
import {inputFailure} from './input-recovery';
import {initialEffects} from './effects-engine';
import {ensureSession} from './session-engine';
import {roll} from './battle-engine';
import {persistentHealingBlocked,persistentDerived} from './combat-persistence';
import {noncombatSpellDefinition,noncombatCastingMinutes} from './noncombat-spell-contract';
import {endNarrativeConcentration,startNarrativeConcentration,noncombatIncapacitated} from './noncombat-concentration';

function requireCast(ok:unknown,field:string,message:string):asserts ok{if(!ok)inputFailure('NONCOMBAT_SPELL_INVALID',field,message);}
const actors=['류크','에보니','워드','네리아','아린'];
export function validateNoncombatCast(state:Campaign,d:any){
 requireCast(d&&typeof d==='object'&&!Array.isArray(d)&&Object.keys(d).every(k=>['actor','spell_id','mode','slot_level','targets'].includes(k)),'data','시전 입력 양식을 확인하세요.');
 requireCast(!state.battle||state.battle.ended,'actor','비전투 시전 경로입니다. 진행 중인 전투는 battle.run의 cast를 사용하세요.');
 requireCast(actors.includes(d.actor)&&!noncombatIncapacitated(state,d.actor),'actor','시전자가 의식을 유지하고 행동할 수 있어야 합니다.');
 const spell=state.spells.find(r=>r.spell_id===d.spell_id&&(r.이름===d.actor||r.캐릭터===d.actor||r.spell_id.startsWith(d.actor+':'))),def=noncombatSpellDefinition(d.spell_id);
 requireCast(spell&&def&&d.spell_id.startsWith(d.actor+':'),'spell_id','시전자가 실제 습득한 등록 주문 ID가 필요합니다.');
 requireCast(Number(spell.레벨)===def.level,'spell_id','등록 주문 레벨과 시전 정의가 일치해야 합니다.');
 requireCast(!def.material_path_required,'spell_id','이 주문은 값이 정해진 재료·소비 또는 소환을 별도 연결해야 합니다. 이 경로에서는 슬롯을 소비하지 않습니다.');
 requireCast(d.spell_id!=='워드:locate_object','spell_id','물체 탐지는 탐지 대상·스캔을 연결하는 locate_object 작업으로 시전하세요.');
 requireCast(!['enhanced_guidance','longstrider'].includes(def.key),'spell_id','상시 인도·활보는 기존 routine 상태를 사용합니다. 중복 시전하지 않습니다.');
 requireCast(!def.ritual_only||d.mode==='ritual','mode','HR-010 능력 강화는 10분 의식·슬롯0·집중 없음으로 시전합니다.');
 const prepared=['준비됨','항상 준비','준비 불필요'].includes(spell['준비 상태']);
 if(d.mode==='ritual'){
  requireCast(def.ritual&&def.level>0&&d.slot_level===undefined,'mode','의식 가능한 주문만 슬롯 없이 의식 시전할 수 있습니다.');
  requireCast(prepared||d.actor==='워드'&&['주문책','의식 주문'].includes(spell.구분)||d.actor==='워드'&&spell['준비 상태']==='의식 주문','spell_id','의식은 실제 준비·습득 또는 위저드 주문책 접근이 필요합니다.');
 }else if(d.mode==='cantrip')requireCast(def.level===0&&prepared&&d.slot_level===undefined,'mode','습득한 소마법은 슬롯 없이 cantrip으로 시전하세요.');
 else {
  requireCast(d.mode==='slot'&&def.level>0&&prepared,'mode','일반 시전은 준비되거나 준비가 불필요한 습득 주문이어야 합니다.');
  const n=d.slot_level??def.level,row=state.resources.find(r=>r.이름===d.actor&&r.자원===`${n}레벨 주문 슬롯`);
  requireCast(Number.isInteger(n)&&n>=def.level&&n<=9&&row&&Number(row.현재)>0,'slot_level','주문 레벨 이상의 사용 가능한 실제 슬롯이 필요합니다.');
 }
 requireCast(d.targets===undefined||Array.isArray(d.targets)&&d.targets.length<=20&&new Set(d.targets).size===d.targets.length&&d.targets.every((x:any)=>typeof x==='string'&&x.trim()&&x.length<=120),'targets','중복 없는 실제 대상 이름을 지정하세요.');
 if(def.healing){
  const max=['mass_healing_word','prayer_of_healing'].includes(def.key)?6:1;
  requireCast(d.targets?.length>0&&d.targets.length<=max&&d.targets.every((a:string)=>actors.includes(a)),'targets',`이 회복 주문에는 실제 HP가 있는 파티 대상 1~${max}명이 필요합니다.`);
  for(const target of d.targets){const hp=state.resources.find(r=>r.이름===target&&r.자원==='HP');requireCast(hp&&Number(hp.최대)>0&&!persistentHealingBlocked(state,target)&&!(state.effects?.magic?.[target]?.conditions??[]).some(c=>['mummy_rot','미이라 부패'].includes(c)),'targets','회복 가능한 실제 대상이 필요합니다. 회복 차단 상태를 확인하세요.');}
 }
 return {spell,def};
}
export function castNoncombatSpell(state:Campaign,d:any,requestId='noncombat-spell'){
 const {spell,def}=validateNoncombatCast(state,d),minutes=noncombatCastingMinutes(d),previous=state.effects?.magic?.[d.actor]?.concentration??null;
 let activity_result:any;
 if(minutes){
  const castingFocus='casting:'+def.key;startNarrativeConcentration(state,d.actor,castingFocus);
  activity_result=advanceActionTime(state,minutes,requestId,'spell-cast-'+def.key,{restartOnInterruption:true});
  if(activity_result.stop_reason==='encounter'){endNarrativeConcentration(state,d.actor);return {actor:d.actor,spell_id:d.spell_id,performed:false,stop_reason:'encounter',restart_required:true,activity_result,slot_consumed:0,duration_management:'gm'};}
  const maintained=state.effects?.magic?.[d.actor]?.concentration===castingFocus;endNarrativeConcentration(state,d.actor);
  if(!maintained)return {actor:d.actor,spell_id:d.spell_id,performed:false,stop_reason:'concentration_lost',restart_required:true,activity_result,slot_consumed:0,duration_management:'gm'};
  try{validateNoncombatCast(state,d);}catch(error){if((error as any)?.diagnostic?.code!=='NONCOMBAT_SPELL_INVALID')throw error;return {actor:d.actor,spell_id:d.spell_id,performed:false,stop_reason:'casting_invalidated',reason:(error as Error).message,restart_required:true,activity_result,slot_consumed:0,duration_management:'gm'};}
 }
 const level=d.mode==='slot'?(d.slot_level??def.level):0;
 if(level){const row=state.resources.find(r=>r.이름===d.actor&&r.자원===`${level}레벨 주문 슬롯`)!;row.현재=String(Number(row.현재)-1);}
 if(def.concentration)startNarrativeConcentration(state,d.actor,def.key);
 const healing:any[]=[];
 if(def.healing){
  const ability=d.actor==='네리아'?4:d.actor==='워드'?3:5,derived=persistentDerived(state,d.actor),mod=Math.floor((derived.abilities[ability]-10)/2),sides=def.key==='cure_wounds'||def.key==='prayer_of_healing'?8:4,count=(def.key==='prayer_of_healing'?2:1)+level-def.level,bonus=mod+(d.actor==='네리아'?2+level:0);
  for(const target of d.targets){const dice=Array.from({length:count},()=>roll(ensureSession(state),sides)),amount=Math.max(0,dice.reduce((a,b)=>a+b,0)+bonus),hp=state.resources.find(r=>r.이름===target&&r.자원==='HP')!,before=Number(hp.현재);hp.현재=String(Math.min(Number(hp.최대),before+amount));recoverAfterHealing(state.effects??=initialEffects(),target,Number(hp.현재),false);healing.push({actor:target,dice,bonus,amount,hp_before:before,hp_after:Number(hp.현재),restored:Number(hp.현재)-before});}
 }
 return {...(activity_result?{activity_result}:{}),performed:true,actor:d.actor,spell_id:d.spell_id,name:spell.주문명,mode:d.mode,slot_consumed:level,casting_minutes:noncombatCastingMinutes(d),concentration:def.concentration,previous_concentration:previous,duration_management:'gm',effect_resolution:def.healing?'hp_applied':'narrative',targets:d.targets??[],...(healing.length?{healing}:{}),panel_markdown:`✨ **${d.actor} — ${spell.주문명}**\n\n${level?`${level}레벨 슬롯 1개 소비`:'슬롯 소비 없음'} · ${def.concentration?'집중 유지 · ':''}지속시간 GM 관리${healing.map(h=>`\n\n${h.actor} HP ${h.hp_before} → ${h.hp_after}`).join('')}`};
}
export function endNoncombatSpell(state:Campaign,d:any){
 requireCast(d&&Object.keys(d).every(k=>['actor','reason'].includes(k))&&actors.includes(d.actor)&&['voluntary','gm_expired'].includes(d.reason),'data','시전자와 종료 사유 voluntary/gm_expired를 지정하세요.');
 requireCast(!state.battle||state.battle.ended,'actor','전투 중에는 battle.run의 end_concentration을 사용하세요.');
 const previous=state.effects?.magic?.[d.actor]?.concentration??null;endNarrativeConcentration(state,d.actor);
 return {actor:d.actor,ended:!!previous,spell:previous,reason:d.reason,duration_management:'gm',panel_markdown:`✨ **${d.actor} 집중 종료**`};
}
