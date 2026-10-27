import {readHandoff} from './action-handoff';
import {routineEnabled} from './routine-buffs';
import {basicSkill,basicSkills} from './basic-skills';
import {inputFailure} from './input-recovery';
import {activeModifiers,modifierTotal} from './world-model';
import {initialEffects,type Effects} from './effects-engine';
import source from './campaign-data.json';
import display from './display-data.json';
export type GearState=Record<string,{active:boolean;attuned:boolean}>;
export const gearCatalog=display.equipment;
export function initialGear():GearState{return Object.fromEntries(gearCatalog.map(e=>[e.id,{active:e.active,attuned:e.attunementRequired}]));}
export function enabled(gear:GearState,id:string){const e=gearCatalog.find(e=>e.id===id);return !!e&&!!gear[id]?.active&&(!e.attunementRequired||gear[id]?.attuned);}
const mod=(n:number)=>Math.floor((n-10)/2);
const names=['류크','에보니','워드','네리아','아린'];
const currentKeys=['클래스','PB','Unnamed: 6','Unnamed: 8','Unnamed: 10','Unnamed: 12'];
const baseKeys=['종족','레벨','전술 역할','Unnamed: 7','Unnamed: 9','Unnamed: 11'];
const saveKeys=['종족','클래스','레벨','PB','전술 역할','Unnamed: 6'];
const abilities=['STR','DEX','CON','INT','WIS','CHA'];
export function derive(gear:GearState,actor:string,effects:Effects=initialEffects()){
 const i=names.indexOf(actor);if(i<0)throw new Error('캐릭터를 찾을 수 없습니다.');
 const on=(id:string)=>enabled(gear,id)?1:0;
 const treasure=gearCatalog.filter(e=>e.owner==='에보니'&&e.attunementRequired&&enabled(gear,e.id)).length>0?1:0;const initial=initialGear();const baseline=(id:string)=>enabled(initial,id)?1:0;
 const raw=source.party.CHARACTER[7+i] as Record<string,string>;
 const stats=baseKeys.map(k=>Number(raw[k]));if(actor==='류크')stats[0]=Math.min(20,stats[0]+(routineEnabled(effects,'sated_warrior')?1:0)+on('01_equipment:22'));
 const modifiers=activeModifiers(effects,actor),basePB=Number(source.party.CHARACTER[i].PB),pbDelta=modifierTotal(modifiers,'proficiency'),proficiencyBonus=Math.max(0,basePB+pbDelta);stats.forEach((v,n)=>stats[n]=v+modifierTotal(modifiers,'ability',abilities[n]));const delta=stats.map((v,n)=>mod(v)-mod(Number(raw[currentKeys[n]])));
 const saves=saveKeys.map((k,n)=>Number((source.party.CHARACTER[14+i] as Record<string,string>)[k])+delta[n]+(Number((source.party.CHARACTER[14+i] as Record<string,string>)[k])-mod(Number(raw[currentKeys[n]]))>=basePB?pbDelta:0)+modifierTotal(modifiers,'save',abilities[n])+(actor==='류크'?on('01_equipment:36')-1:0));
 const skills=source.party.SKILLS.filter(r=>r['이름']===actor).map(r=>{let value=Number(r['최종 합계'])+Math.floor(proficiencyBonus*(({PROF:1,EXPERTISE:2,EXPERT:2,HALF:.5} as Record<string,number>)[r['숙련 단계']]??0))-Math.floor(basePB*(({PROF:1,EXPERTISE:2,EXPERT:2,HALF:.5} as Record<string,number>)[r['숙련 단계']]??0))+delta[abilities.indexOf(r['기반 능력'])];const contributions: {name:string;value:number}[]=[];
 const add=(id:string,n:number)=>{value+=(on(id)-baseline(id))*n;if(on(id))contributions.push({name:display.items[id as keyof typeof display.items].name,value:n});};
 if(actor==='워드'&&['Arcana','Investigation','History'].includes(r['기술']))add('03_etc:13',1);
 if(actor==='아린'&&['Stealth','Perception'].includes(r['기술']))add('01_equipment:32',1);
 if(actor==='아린'&&r['기술']==='Performance')add('01_equipment:33',1);
 value+=modifierTotal(modifiers,'skill',r['기술']);return {...r,'최종 합계':String(value),baseBonus:value-contributions.reduce((a,b)=>a+b.value,0),contributions};});
 const dex=mod(stats[1]);let ac=10+dex;const acParts:{name:string;value:number}[]=[];
 const part=(name:string,value:number)=>acParts.push({name,value});
 if(actor==='류크'){ac=10+dex+mod(stats[2]);part('비장갑 방어',ac);for(const [id,n]of [['01_equipment:5',1],['01_equipment:7',3],['01_equipment:28',1]] as const)if(on(id)){ac+=n;part(display.items[id].name,n);}}
 if(actor==='워드'){ac=17;part('자연 방어',17);}
 if(actor==='네리아'){ac=on('01_equipment:1')?16:10+dex;part(on('01_equipment:1')?'체인 메일':'비착용 방어',ac);for(const [id,n]of [['01_equipment:0',3],['01_equipment:2',1]]as const)if(on(id)){ac+=n;part(display.items[id].name,n);}}
 if(actor==='아린'){ac=on('01_equipment:30')?12+dex+1:10+dex;part(on('01_equipment:30')?'스터디드 레더 +1':'비착용 방어',ac);}
 if(actor==='에보니'){ac=on('01_equipment:16')?11+dex+1:10+dex;part(on('01_equipment:16')?'레더 아머 +1':'비착용 방어',ac);if(on('01_equipment:34')){ac++;part('그림자 도약 발찌 +1',1);}}
 const stoneDelta=actor==='류크'&&!routineEnabled(effects,'whetstone')?-1:0;
 const hit=[10,11,9,6,9][i]+stoneDelta+delta[[0,1,3,0,5][i]];
 const hitGear:Record<string,string[]>={'류크':['01_equipment:4'],'에보니':['01_equipment:17','01_equipment:23'],'워드':['01_equipment:27'],'네리아':['01_equipment:3'],'아린':['01_equipment:29']};
 const attack=modifierTotal(modifiers,'attack')+pbDelta+hit+(actor==='에보니'?treasure-1:0)+hitGear[actor].reduce((v,id)=>v+on(id)-baseline(id),0);
 const mainId=['01_equipment:4','01_equipment:17',null,'01_equipment:3',null][i];
 const damageBonus=stoneDelta+modifierTotal(modifiers,'damage')+(actor==='에보니'?treasure-1:0)+[9,7,0,3,6][i]-(actor==='류크'&&!effects.rage.active?2:0)+delta[[0,1,3,0,5][i]]+(actor==='류크'?on('01_equipment:4')-1:actor==='에보니'?on('01_equipment:17')-1:actor==='네리아'?on('01_equipment:3')-1:actor==='아린'?on('01_equipment:29')-1:0);
 const damage=actor==='류크'?`1d8${effects.rage.active?'+1d6':''}+${damageBonus} ${effects.rage.active?effects.rage.element:'참격'}${on('01_equipment:6')?' + 2 참격':''}`:actor==='에보니'?`1d6+${damageBonus} 관통`:actor==='네리아'?`1d6+${damageBonus} 타격`:actor==='아린'?`1d8+${damageBonus}`:'2d10 화염';
 const move=(routineEnabled(effects,'longstrider')?0:-3)+modifierTotal(modifiers,'speed')+[15.2,12.2,12.1,12.1,13.7][i]+(actor==='에보니'?1.5*on('01_equipment:24'):0);
 ac+=modifierTotal(modifiers,'ac');if(modifierTotal(modifiers,'ac'))acParts.push({name:'추가 적용 효과',value:modifierTotal(modifiers,'ac')});if(effects.magic?.[actor]?.ac){ac+=effects.magic[actor].ac;acParts.push({name:'주문 효과',value:effects.magic[actor].ac});}return {actor,proficiencyBonus,initiativeBonus:modifierTotal(modifiers,'initiative')+(actor==='에보니'&&gearCatalog.filter(e=>e.owner===actor&&e.attunementRequired&&enabled(gear,e.id)).length>=3?1:0),damage,strengthAdvantage:actor==='류크'&&effects.rage.active,mainAttackAvailable:mainId===null||!!on(mainId),passiveEffects:gearCatalog.filter(e=>e.owner===actor&&enabled(gear,e.id)).map(e=>({id:e.id,effect:e.effect})),abilities:stats,saves,skills,ac,acParts,attack,move,spellDC:actor==='워드'?16+pbDelta+on('01_equipment:27')+delta[3]:actor==='아린'?16+pbDelta+on('01_equipment:29')+delta[5]:actor==='네리아'?16+pbDelta+delta[4]:null,equipment:[...gearCatalog.filter(e=>e.owner===actor).map(e=>({...e,...gear[e.id],effective:enabled(gear,e.id)})),...(effects.customEquipment??[]).filter(e=>e.owner===actor).map(e=>({...e,type:'장비'}))]};
}
export function resolveSkillRow(gear:GearState,actor:string,value:unknown,effects:Effects=initialEffects(),derived?:ReturnType<typeof derive>){
 if(!names.includes(actor))inputFailure('UNKNOWN_ACTOR','actor',`등록되지 않은 캐릭터: ${String(actor)}`,{allowed_actors:names},['actor를 반환된 현재 파티원 이름으로 수정하세요.']);
 const skill=basicSkill(value);if(!skill)inputFailure('UNKNOWN_SKILL','skill',`${actor}: 기술 ${String(value)}을 찾을 수 없습니다.`,{received:value,accepted_skills:basicSkills.map(({id,label,ability,aliases})=>({id,label,ability,aliases})),lookup:readHandoff('get_campaign_state',{view:'party',actor})},['skill을 반환된 표준 기술 ID 또는 한국어 이름으로 수정하세요. 등록 목록에 없는 기본 기술도 비숙련 판정을 지원합니다.','확인이 필요하면 read_action으로 get_campaign_state(view=party,actor=해당 캐릭터) 액션을 조회하세요. 미지원 특수 능력을 일반 판정으로 대체하지 마세요.'],{actor});
 const d=derived??derive(gear,actor,effects),found=d.skills.find(r=>r['기술']===skill.name);
 if(found)return {...found,displayName:(display.skills as any)[found.index]?.name??skill.label,skill_source:'character_sheet'};
 const bonus=Math.floor((d.abilities[abilities.indexOf(skill.ability)]-10)/2)+modifierTotal(activeModifiers(effects,actor),'skill',skill.name);
 return {index:'basic:'+actor+':'+skill.id,'이름':actor,'기술':skill.name,'기반 능력':skill.ability,'숙련 단계':'NONE','최종 합계':String(bonus),baseBonus:bonus,contributions:[] as {name:string;value:number}[],displayName:skill.label,skill_source:'ability_only'};
}
export function validateHarvest(harvest:{target?:string;tool?:string}|undefined,identified=false){
 if(!identified)throw new Error('채취 부위를 먼저 식별해야 합니다.');
 if(harvest?.target!==undefined&&!['corpse','ore','plant','other'].includes(harvest.target))throw new Error('채취 대상은 corpse·ore·plant·other입니다.');
 if(harvest?.tool!==undefined&&(typeof harvest.tool!=='string'||!harvest.tool.trim()||harvest.tool.length>100))throw new Error('사용할 채취 도구를 지정해 주세요.');
 if(harvest?.target==='ore'&&(!harvest.tool||harvest.tool==='03_etc:8'||/단검|dagger|knife/i.test(harvest.tool)))throw new Error('광석 채굴에는 곡괭이·망치와 정 등 대상에 맞는 도구를 지정해 주세요.');
}
export function checkBonus(gear:GearState,actor:string,skill:string,purpose:string,identified=false,effects:Effects=initialEffects(),harvest?:{target?:'corpse'|'ore'|'plant'|'other';tool?:string},resolved?:ReturnType<typeof resolveSkillRow>){
 if(!['general','lock','trap','harvest','hearing','sight'].includes(purpose))throw new Error('지원하지 않는 판정 목적입니다.');
 const r=resolved??resolveSkillRow(gear,actor,skill,effects);skill=r['기술'];
 const extras:{name:string;value:number}[]=[];
 if(['lock','trap'].includes(purpose)&&skill!=='Sleight of Hand')throw new Error('해당 목적에는 손재주 판정을 사용합니다.');
 if(actor==='에보니'&&['lock','trap'].includes(purpose)&&enabled(gear,'01_equipment:26'))extras.push({name:'관리자의 만능열쇠',value:1});
 if(purpose==='harvest'){validateHarvest(harvest,identified);if(actor==='에보니'&&skill==='Sleight of Hand'&&harvest?.tool==='03_etc:8'&&enabled(gear,'03_etc:8'))extras.push({name:'감응 채집단검 — 개량형',value:2});}
 return {actor,skill,purpose,skill_source:r.skill_source,proficiency_scale:({PROF:1,EXPERTISE:2,EXPERT:2,HALF:.5} as Record<string,number>)[r['숙련 단계']]??0,baseBonus:r.baseBonus,gearBonuses:r.contributions,extras,totalBonus:Number(r['최종 합계'])+extras.reduce((a,b)=>a+b.value,0),bonusDice:routineEnabled(effects,'guidance')?'1d4':null,advantage:actor==='류크'&&effects.rage.active&&r['기반 능력']==='STR',inspiration:effects.inspiration[actor]??null,rolled:false};
}

export function actionFormula(gear:GearState,actor:string,name:string,formula:string,effects:Effects=initialEffects()){
 const initial=initialGear();const d=derive(gear,actor,effects);let change=0;const diff=(id:string,n=1)=>n*((enabled(gear,id)?1:0)-(enabled(initial,id)?1:0));
 const physical=/( 배틀액스|배틀액스|돌날개 철퇴|기계식 증기 단검|은도금 숏소드|롱보우|레이피어|손도끼|투창)/.test(name);
 const attack=/^(?:1)?d20/i.test(formula);const damage=/^(?:\d+)?d\d+\+\d+$/i.test(formula)&&!attack;
 if(!attack&&!damage)return formula;
 if(actor==='류크'&&physical){if(damage&&!effects.rage.active)change-=2;change+=Math.floor((d.abilities[0]-10)/2)-5;if(name.includes('배틀액스'))change+=diff('01_equipment:4')+(routineEnabled(effects,'whetstone')?0:-1);}
 if(actor==='네리아'&&name.includes('돌날개 철퇴'))change+=diff('01_equipment:3');
 if(actor==='에보니'&&physical){if(attack)change+=diff('01_equipment:23');if(name.includes('기계식 증기 단검'))change+=diff('01_equipment:17');}
 if(actor==='워드'&&attack)change+=diff('01_equipment:27');
 if(actor==='아린'&&((attack&&!physical)||name.includes('마력의 선율')))change+=diff('01_equipment:29');
 change+=modifierTotal(activeModifiers(effects,actor),attack?'attack':'damage');return formula.replace(/([+-])(\d+)$/,(_,sign,n)=>{const total=(sign==='-'?-1:1)*Number(n)+change;return (total<0?'':'+')+total;});
}
