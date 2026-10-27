import type {Campaign} from '../campaign';
import {inputFailure} from '../input-recovery';
import {locationDefinitions,locationVisible,resolvePlaceId} from '../place-management';
import {advanceActivity,pendingEncounter} from './activity';
import {activityIdentity} from './activity-identity';
import {travelMultipliers,type TravelMode,type TravelRoute} from './travel-config';
import {localTravelRoutes,localRouteSource} from './local-routes';

const maxSegments=50,maxMinutes=10080;
export type JourneySegment={route_id:string;origin_id:string;destination_id:string;activity_id:string;total_minutes:number};
export type JourneyPlan={version:1;origin_id:string;destination_id:string;requested_destination_id?:string;actual_destination_id?:string;travel_mode:TravelMode;index:number;elapsed_minutes:number;total_minutes:number;segments:JourneySegment[]};
const fail=(field:string,message:string):never=>inputFailure('JOURNEY_INVALID',field,message,{next_action:'STOP',partial_move_allowed:false},['최종 목적지에 도달할 수 없으면 이동을 중단하고 이유를 알리세요. 실패한 목적지를 중간 목적지로 바꿔 연속 이동하지 마세요.','시간·위치·경로를 추측하거나 새 구간을 만들어 진행하지 마세요. 공식 가능한 목적지와 확정된 경로만 사용하세요.']);
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
function available(state:Campaign){
 if(!state.life?.enabled)fail('journey','생활 세계 활성화가 필요합니다.');
 if(state.battle&&!state.battle.ended)fail('journey','전투 종료 후 이동하세요.');
 if(pendingEncounter(state))fail('journey','진행 중인 조우에 먼저 대응하세요.');
}
/** Resolve visibility once per distinct place; do not load or clone campaign history. */
function routeView(state:Campaign,mode:TravelMode){
 const definitions=locationDefinitions(state),visible=new Map<string,boolean>();
 const canonical=(id:string)=>resolvePlaceId(state,id);
 const known=(id:string)=>{if(!visible.has(id)){const loc=definitions[canonical(id)];visible.set(id,!!loc&&!loc.archived&&locationVisible(state,id,definitions));}return visible.get(id)!;};
 const connected=(from:string,to:string)=>known(from)&&known(to)&&!(definitions[canonical(from)].hidden_connections??[]).some(id=>canonical(id)===canonical(to))&&!(definitions[canonical(to)].hidden_connections??[]).some(id=>canonical(id)===canonical(from));
 const valid=(route:TravelRoute)=>!!route&&typeof route.id==='string'&&typeof route.from_id==='string'&&typeof route.to_id==='string'&&typeof route.via_id==='string'&&route.from_id!==route.to_id&&canonical(route.from_id)===route.from_id&&canonical(route.to_id)===route.to_id&&Number.isInteger(route.walking_minutes)&&route.walking_minutes>0&&Array.isArray(route.modes)&&route.modes.includes(mode)&&[route.from_id,route.to_id,route.via_id].every(known)&&connected(route.from_id,route.to_id)&&connected(route.from_id,route.via_id)&&connected(route.via_id,route.to_id);
 return {definitions,known,connected,valid,routes:{...localTravelRoutes(state,definitions),...state.life!.routes}};
}
function travelMode(value:unknown):TravelMode{
 const mode=value??'walk';if(typeof mode!=='string'||!Object.hasOwn(travelMultipliers,mode))fail('journey.travel_mode','지원되는 이동 방식을 지정하세요.');return mode as TravelMode;
}
type Edge={route:TravelRoute;to:string;minutes:number};
type Path={id:string;minutes:number;key:string;edges:Edge[]};
/** One search serves both planning and the bounded list of executable destinations. */
function journeyNetwork(state:Campaign,mode:TravelMode){
 const view=routeView(state,mode),origin=resolvePlaceId(state,state.location?.location_id??'');
 if(!view.known(origin))fail('journey','현재 장소는 발견된 활성 장소여야 합니다.');
 const graph=new Map<string,Edge[]>();
 for(const [key,route]of Object.entries(view.routes)){
  if(key!==route.id||!view.valid(route))continue;
  const minutes=Math.ceil(route.walking_minutes*travelMultipliers[mode]/100);
  for(const [from,to]of [[route.from_id,route.to_id],[route.to_id,route.from_id]]){const edges=graph.get(from)??[];edges.push({route,to,minutes});graph.set(from,edges);}
 }
 const registeredReachable=new Set<string>([origin]),queue=[origin];
 for(let i=0;i<queue.length;i++)for(const edge of graph.get(queue[i])??[])if(!edge.route.source_refs.includes(localRouteSource)&&!registeredReachable.has(edge.to)){registeredReachable.add(edge.to);queue.push(edge.to);}
 const best=new Map<string,Path>([[origin,{id:origin,minutes:0,key:'',edges:[]}]]),visited=new Set<string>();
 while(true){
  const next=[...best.values()].filter(p=>!visited.has(p.id)).sort((a,b)=>a.minutes-b.minutes||compare(a.key,b.key)||compare(a.id,b.id))[0];
  if(!next)break;visited.add(next.id);
  for(const edge of graph.get(next.id)??[]){
   if(visited.has(edge.to))continue;
   const minutes=next.minutes+edge.minutes;if(minutes>maxMinutes)continue;
   const key=next.key+'\0'+edge.route.id,previous=best.get(edge.to);
   if(!previous||minutes<previous.minutes||minutes===previous.minutes&&compare(key,previous.key)<0)best.set(edge.to,{id:edge.to,minutes,key,edges:[...next.edges,edge]});
  }
 }
 return {view,origin,best,registeredReachable};
}
function settlementDestination(view:ReturnType<typeof routeView>,id:string){
 const loc=view.definitions[id];
 return !!loc&&view.known(id)&&loc.background==='village'&&!loc.parent_location_id&&!!loc.area_id&&loc.name===loc.area_name&&loc.habitat?.safe_zone===true&&loc.habitat.environments.includes('urban');
}
function resolvedDestination(network:ReturnType<typeof journeyNetwork>,requested:string){
 const {view,origin,best}=network,exact=best.get(requested);
 const authoredArrival=network.registeredReachable.has(requested);
 const localSettlementArrival=settlementDestination(view,requested)&&!authoredArrival&&view.definitions[origin].area_id!==view.definitions[requested].area_id&&exact?.edges.at(-1)?.route.source_refs.includes(localRouteSource);
 if(exact?.edges.length&&exact.edges.length<=maxSegments&&!localSettlementArrival)return {path:exact,resolution:'exact' as const};
 if(!settlementDestination(view,requested))return undefined;
 const area=view.definitions[requested].area_id;
 // An existing physical location inside the settlement is already there; never invent a departure/return.
 if(view.definitions[origin].area_id===area)return undefined;
 const path=[...best.values()].filter(p=>p.edges.length>0&&p.edges.length<=maxSegments&&view.definitions[p.id]?.area_id===area&&view.known(p.id)&&view.connected(requested,p.id)).sort((a,b)=>a.minutes-b.minutes||compare(a.key,b.key)||compare(a.id,b.id))[0];
 return path?{path,resolution:'settlement' as const}:undefined;
}
/** Shortest known registered route; settlement requests may resolve to a concrete arrival inside that area. */
export function planJourney(state:Campaign,destination_id:string,travel_mode:TravelMode|undefined,request_id:string):JourneyPlan{
 available(state);
 if(state.life!.activity&&state.life!.activity.status!=='complete')fail('journey','진행 중 활동을 먼저 재개하거나 종료하세요.');
 const mode=travelMode(travel_mode),network=journeyNetwork(state,mode),{view,origin}=network,destination=typeof destination_id==='string'?resolvePlaceId(state,destination_id):'';
 if(!view.known(destination))fail('journey.destination_id','목적지는 발견된 활성 장소여야 합니다.');
 if(origin===destination)fail('journey.destination_id','현재 장소와 다른 목적지를 지정하세요.');
 if(typeof request_id!=='string'||!request_id||request_id.length>120)fail('request_id','유효한 요청 ID가 필요합니다.');
 const selected=resolvedDestination(network,destination)?.path;
 if(!selected&&settlementDestination(view,destination)&&view.definitions[origin].area_id===view.definitions[destination].area_id)fail('journey.destination_id','현재 실제 위치가 이미 요청한 정착지 안에 있습니다. 추가 이동 시간 없이 현재 위치에서 계속하세요.');
 if(!selected)return fail('journey.destination_id','현재 이동 방식으로 연결된 발견 경로가 없거나 전체 이동 시간이 10080분을 초과합니다.');
 let from=origin;
 const segments=selected.edges.map((edge,index)=>{const segment={route_id:edge.route.id,origin_id:from,destination_id:edge.to,activity_id:activityIdentity('journey-'+index,request_id),total_minutes:edge.minutes};from=edge.to;return segment;});
 return {version:1,origin_id:origin,destination_id:selected.id,requested_destination_id:destination,actual_destination_id:selected.id,travel_mode:mode,index:0,elapsed_minutes:0,total_minutes:selected.minutes,segments};
}
/** Read-only, reachable-only choices; never send the full location archive as movement targets. */
export function reachableJourneyDestinations(state:Campaign,options:{travel_mode?:TravelMode;page?:number;query?:string}={}){
 available(state);const mode=travelMode(options.travel_mode),network=journeyNetwork(state,mode),page=options.page??1,query=String(options.query??'').toLowerCase();
 if(!Number.isInteger(page)||page<1)fail('page','가능한 목적지 페이지는 1 이상의 정수입니다.');
 const rows=[];
 for(const loc of Object.values(network.view.definitions)){
  if(loc.id===network.origin||resolvePlaceId(state,loc.id)!==loc.id||!network.view.known(loc.id))continue;
  const resolved=resolvedDestination(network,loc.id);if(!resolved)continue;
  const actual=network.view.definitions[resolved.path.id];
  if(query&&!`${loc.name} ${actual.name}`.toLowerCase().includes(query))continue;
  rows.push({destination_id:loc.id,name:loc.name,actual_destination_id:actual.id,actual_destination_name:actual.name,total_minutes:resolved.path.minutes,total_segments:resolved.path.edges.length,resolution:resolved.resolution});
 }
 rows.sort((a,b)=>a.total_minutes-b.total_minutes||compare(a.name,b.name)||compare(a.destination_id,b.destination_id));
 return {origin_id:network.origin,travel_mode:mode,items:rows.slice((page-1)*25,page*25),pagination:{page,page_size:25,total:rows.length,next_page:page*25<rows.length?page+1:null}};
}
function validatedPlan(state:Campaign,input:JourneyPlan):JourneyPlan{
 if(!input||input.version!==1||!Array.isArray(input.segments)||!input.segments.length||input.segments.length>maxSegments||!Number.isInteger(input.index)||input.index<0||input.index>input.segments.length||!Number.isInteger(input.elapsed_minutes)||input.elapsed_minutes<0||!Number.isInteger(input.total_minutes)||input.total_minutes<1||input.total_minutes>maxMinutes)fail('journey','유효한 저장 여정과 진행도가 필요합니다.');
 const mode=travelMode(input.travel_mode),view=routeView(state,mode),ids=new Set<string>();let from=input.origin_id,total=0,completed=0;
 for(const [index,segment]of input.segments.entries()){
  if(!segment||typeof segment!=='object')fail('journey','저장 여정 구간은 유효한 객체여야 합니다.');
  const route=view.routes[segment.route_id];
  if(!segment||!route||!view.valid(route)||route.id!==segment.route_id||segment.origin_id!==from||!((route.from_id===from&&route.to_id===segment.destination_id)||(route.to_id===from&&route.from_id===segment.destination_id))||!Number.isInteger(segment.total_minutes)||segment.total_minutes!==Math.ceil(route.walking_minutes*travelMultipliers[mode]/100)||typeof segment.activity_id!=='string'||!segment.activity_id||segment.activity_id.length>100||ids.has(segment.activity_id))fail('journey','저장 여정의 모든 구간·시간·이동 방식이 현재 등록 경로와 일치해야 합니다.');
  ids.add(segment.activity_id);from=segment.destination_id;total+=segment.total_minutes;if(index<input.index)completed+=segment.total_minutes;
 }
 if(from!==input.destination_id||total!==input.total_minutes||input.elapsed_minutes>total)fail('journey','저장 여정의 목적지와 총시간이 일치하지 않습니다.');
 const requested=input.requested_destination_id??input.destination_id;
 if(input.actual_destination_id!==undefined&&input.actual_destination_id!==input.destination_id||typeof requested!=='string'||!view.known(requested)||requested!==input.destination_id&&(!settlementDestination(view,requested)||view.definitions[requested].area_id!==view.definitions[input.destination_id]?.area_id||!view.connected(requested,input.destination_id)))fail('journey','저장 여정의 요청 목적지와 실제 도착 장소가 일치해야 합니다.');
 const segment=input.segments[input.index],activity=state.life!.activity;
 if(segment&&activity?.id===segment.activity_id){
  if(activity.kind!=='travel'||activity.status==='complete'||activity.origin_id!==segment.origin_id||activity.destination_id!==segment.destination_id||activity.route_id!==segment.route_id||activity.total_minutes!==segment.total_minutes||activity.travel?.mode!==mode||activity.travel.direction!==1||activity.elapsed_minutes<0||activity.elapsed_minutes>activity.total_minutes||input.elapsed_minutes!==completed+activity.elapsed_minutes||![segment.origin_id,activity.travel.route.via_id].includes(state.location?.location_id??''))fail('journey','현재 이동 활동이 저장 여정의 진행도와 일치하지 않습니다.');
 }else if(input.elapsed_minutes!==completed||activity&&activity.status!=='complete'||state.location?.location_id!==(segment?.origin_id??input.destination_id))fail('journey','현재 위치·활동과 저장 여정이 일치하지 않습니다.');
 return {...structuredClone(input),requested_destination_id:requested,actual_destination_id:input.destination_id};
}
/** Execute existing single-segment mechanics until arrival, budget boundary, or the first real encounter. */
export function advanceJourney(state:Campaign,input:{plan:JourneyPlan;minutes?:number},request_id:string){
 available(state);const plan=validatedPlan(state,input?.plan);
 if(input.minutes!==undefined&&(!Number.isInteger(input.minutes)||input.minutes<0||input.minutes>maxMinutes))fail('journey.minutes','이번 요청 시간 상한은 0~10080분의 정수입니다.');
 let budget=Math.min(input.minutes??maxMinutes,plan.total_minutes-plan.elapsed_minutes),elapsed=0,stop='elapsed',last:any;
 const encounter_checks:any[]=[];
 while(plan.index<plan.segments.length){
  const segment=plan.segments[plan.index],current=state.life!.activity;
  const needsArrival=current?.id===segment.activity_id&&current.elapsed_minutes===current.total_minutes;
  if(budget===0&&!needsArrival)break;
  last=advanceActivity(state,{activity_id:segment.activity_id,kind:'travel',origin_id:segment.origin_id,destination_id:segment.destination_id,route_id:segment.route_id,travel_mode:plan.travel_mode,minutes:budget},request_id);
  const advanced=last.elapsed_minutes;elapsed+=advanced;budget-=advanced;plan.elapsed_minutes+=advanced;encounter_checks.push(...last.encounter_checks);
  if(last.stop_reason==='encounter'){stop='encounter';break;}
  if(last.activity.status!=='complete')break;
  plan.index++;
 }
 if(plan.index===plan.segments.length)stop='arrived';
 const remaining=plan.total_minutes-plan.elapsed_minutes;
 return {elapsed_minutes:elapsed,remaining_minutes:remaining,stop_reason:stop,encounter_checks,encounter_check_status:encounter_checks.length?'checked':'waiting',...(last?.activity?{activity:last.activity}:state.life!.activity?{activity:structuredClone(state.life!.activity)}:{}),...(last?.encounter?{encounter:last.encounter}:{}),journey:{status:stop,origin_id:plan.origin_id,destination_id:plan.destination_id,requested_destination_id:plan.requested_destination_id,actual_destination_id:plan.actual_destination_id,travel_mode:plan.travel_mode,total_segments:plan.segments.length,completed_segments:plan.index,total_minutes:plan.total_minutes,elapsed_minutes:plan.elapsed_minutes,remaining_minutes:remaining},...(stop!=='arrived'?{continuation_data:{plan,minutes:remaining}}:{})};
}
