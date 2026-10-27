import {monsterCR,threatBand} from '../encounter-threat';
import {encounterDefaults,locationType} from './encounter-policy';
import type {Campaign} from '../campaign';
import {lookup,routeVisible} from '../place-management';
import {inputFailure} from '../input-recovery';
import {builtinMonsters,monsterListEntry} from '../monster-archive';
import {lifeNow} from './state';
import {localTravelRoutes} from './local-routes';
export const travelMultipliers={walk:100,caravan:110,wagon:90,escort:160,horse:70} as const;
export type TravelMode=keyof typeof travelMultipliers;
export type PlaceLife={location_id:string;profile_id:string;risk?:number;source_refs:string[];monster_ids?:string[];risk_adjustment?:{delta:number;until:number;reason:string}};
export type TravelRoute={id:string;from_id:string;to_id:string;via_id:string;walking_minutes:number;modes:TravelMode[];source_refs:string[]};
export function registerPlace(state:Campaign,p:PlaceLife){lookup(state,p.location_id,'data.location_id');for(const id of p.monster_ids??[]){const m=builtinMonsters[id],info=m&&monsterListEntry(m);const raw=String(m?.data.CR??''),cr=raw.includes('/')?Number(raw.split('/')[0])/Number(raw.split('/')[1]):Number(raw);if(!info?.creation.automation.automatic_combat||!Number.isFinite(cr)||cr>threatBand(p.risk??encounterDefaults[locationType(p.profile_id)].risk).max)inputFailure('UNSAFE_RANDOM_CANDIDATE','data.monster_ids','일반 자동 조우는 장소 위험도의 CR 상한 내 실행 가능한 원형만 등록합니다.');} (state.life!.places??={})[p.location_id]=structuredClone(p);return {place:p};}
export function registerRoute(state:Campaign,p:TravelRoute){for(const key of ['from_id','to_id','via_id'] as const)lookup(state,p[key],'data.'+key);if(p.from_id===p.to_id)inputFailure('INVALID_ROUTE','data.to_id','출발지와 목적지는 달라야 합니다.');if(!state.life!.places?.[p.via_id])inputFailure('MISSING_ROUTE_PROFILE','data.via_id','경유 장소의 life_place 유형·위험도를 먼저 등록하세요.');(state.life!.routes??={})[p.id]=structuredClone(p);return {route:p};}
export function resolveRoute(state:Campaign,p:any){const r=state.life!.routes?.[p.route_id]??localTravelRoutes(state)[p.route_id];if(!r)inputFailure('ROUTE_NOT_REGISTERED','data.route_id','등록된 이동 구간이 필요합니다. life_route로 출발·도착·경유 장소와 기본 도보 시간을 등록하세요.');if(!routeVisible(state,r))inputFailure('ROUTE_UNDISCOVERED','data.route_id','이동 구간의 장소와 연결을 먼저 발견 처리하세요.');if(!((p.origin_id===r.from_id&&p.destination_id===r.to_id)||(p.origin_id===r.to_id&&p.destination_id===r.from_id)))inputFailure('ROUTE_ENDPOINT_MISMATCH','data.destination_id','선택한 구간의 양 끝 장소를 지정하세요.',{allowed_values:[r.from_id,r.to_id]});const mode:TravelMode=p.travel_mode??'walk';if(!r.modes.includes(mode))inputFailure('TRAVEL_MODE_UNAVAILABLE','data.travel_mode','이 구간에서 허용되지 않는 이동 방식입니다.',{allowed_values:r.modes});return {route:structuredClone(r),mode,multiplier:travelMultipliers[mode]/100};}
export function effectiveRisk(state:Campaign,p:PlaceLife){const adjustment=p.risk_adjustment;return Math.max(0,Math.min(7,(p.risk??encounterDefaults[locationType(p.profile_id)].risk)+(adjustment&&lifeNow(state)<adjustment.until?adjustment.delta:0)));}
