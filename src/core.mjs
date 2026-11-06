/* Pure domain logic — can be tested without Cloudflare or real provider keys. */
const IATA = /^[A-Z0-9]{2,3}$/;
export const UK_AIRPORTS = ['LHR','LGW','STN','LTN','LCY','SEN','BRS','BHX','MAN','LPL','EMA','BOH','SOU','NWI','CWL'];
export const LONDON = new Set(['LHR','LGW','STN','LTN','LCY','SEN']);
export const LOW_COST = new Set(['FR','RK','W6','W9','U2','EZY','LS','VY','V7','D8','DY','EW','TO','BA']);
export const iso = x => typeof x==='string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x+'T00:00:00Z'));
export const iata = x => (typeof x==='string' ? x.trim().toUpperCase() : '');
export const time = x => { if(typeof x!=='string')return null; const s=x.replace(':','').slice(0,4); return /^([01]\d|2[0-3])[0-5]\d$/.test(s) ? s.slice(0,2)+':'+s.slice(2) : null; };
export const weekdays = x => { // 1=Mon..7=Sun; OAG uses seven 0/1 digits (Mon..Sun)
  if (typeof x==='number') return Array.from({length:7},(_,i)=>(x&(1<<i))?i+1:null).filter(Boolean);
  if(Array.isArray(x))return [...new Set(x.flatMap(y=>weekdays(String(y))))].sort();
  if(typeof x==='string'){
    const s=x.trim();
    if(/^[01]{7}$/.test(s))return [...s].flatMap((d,i)=>d==='1'?[i+1]:[]);
    if(/^[1-7]{2,7}$/.test(s))return [...new Set([...s].map(Number))].sort();
    if(/^[1-7.\-]{7}$/.test(s))return [...s].flatMap((x,i)=>x===String(i+1)?[i+1]:[]);
    const names={mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sun:7};
    return [...new Set(s.split(/[,;\s]+/).map(v=>names[v.toLowerCase().slice(0,3)]||Number(v)).filter(v=>v>=1&&v<=7))].sort();
  }
  return [];
};
export const dayOfWeek = s => {const d=new Date(s+'T12:00:00Z').getUTCDay();return d===0?7:d;};
export const operates = (r,date) => iso(date)&&(!r.valid_from||date>=r.valid_from)&&(!r.valid_to||date<=r.valid_to)&&weekdays(r.days).includes(dayOfWeek(date));
export const hashInput = r => [r.source,r.carrier,r.flight_no,r.origin,r.destination,r.dep_time,r.arr_time,(r.days||[]).join(','),r.valid_from||'',r.valid_to||'',r.arrival_offset||0].join('|');
export function normalizeAirLabs(r){
  if(!r||typeof r!=='object')throw Error('AirLabs row must be object');
  const origin=iata(r.dep_iata),destination=iata(r.arr_iata),carrier=iata(r.airline_iata);
  if(!IATA.test(origin)||!IATA.test(destination)||!carrier||!time(r.dep_time))throw Error('AirLabs missing essential fields');
  const days=weekdays(r.days); if(!days.length)throw Error('AirLabs missing operating days');
  return {source:'airlabs',carrier,flight_no:String(r.flight_iata||r.flight_icao||'').trim().toUpperCase(),origin,destination,dep_time:time(r.dep_time),arr_time:time(r.arr_time),days,valid_from:null,valid_to:null,validity:'UNKNOWN_SEASON',arrival_offset:null,service_type:r.service_type||'',state:'ACTIVE'};
}
export function normalizeOAG(r){
  if(!r||typeof r!=='object')throw Error('OAG schedule must be object');
  const carrier=iata(typeof r.carrier==='object' ? (r.carrier?.iata||r.carrier?.code) : (r.carrier||r.Carrier));
  const origin=iata(typeof r.departure?.airport==='object'?r.departure.airport.iata:r.departure?.airport);
  const destination=iata(typeof r.arrival?.airport==='object'?r.arrival.airport.iata:r.arrival?.airport);
  const dep_time=time(r.departure?.passengerLocalTime||r.departure?.localTime);
  const arr_time=time(r.arrival?.passengerLocalTime||r.arrival?.localTime);
  const days=weekdays(r.legDaysOfOperation||r.daysOfOperation);
  const valid_from=r.startDate,valid_to=r.endDate;
  if(!carrier||!origin||!destination||!dep_time||!days.length||!iso(valid_from)||!iso(valid_to)||valid_from>valid_to)throw Error('OAG effective fields missing/invalid');
  return {source:'oag',carrier,flight_no:carrier+String(r.flightNumber??'').trim(),origin,destination,dep_time,arr_time,days,valid_from,valid_to,validity:'DATE_RANGE',arrival_offset:Number.isFinite(Number(r.legArrivalIntervalDays))?Number(r.legArrivalIntervalDays):null,service_type:r.serviceType||'',state:'ACTIVE'};
}
export function normalizeOAGDelta(e){
  if(!e||typeof e!=='object')throw Error('Delta is not object');
  // Effective schedule changes can update weekly rules. Flight-instance changes cannot.
  const record=e.schedule||e.data||e;
  if(record.startDate && record.endDate && record.legDaysOfOperation){
    const rule=normalizeOAG(record);return {kind:'RULE',action:String(e.state||e.status||'UPDATED').toUpperCase(),rule};
  }
  const dep=record.departure||{},arr=record.arrival||{};
  const rawNumber=String(record.flightNumber||record.flight?.number||'').trim();
  const carrier=typeof record.carrier==='string'?record.carrier:(record.carrier?.iata||record.airline?.iata||'');
  const flight_no=/^\d/.test(rawNumber)?String(carrier).toUpperCase()+rawNumber:rawNumber;
  const origin=iata(typeof dep.airport==='object'?dep.airport.iata:dep.airport);
  const destination=iata(typeof arr.airport==='object'?arr.airport.iata:arr.airport);
  const date=(typeof dep.date==='object'?dep.date?.local:dep.date)||dep.dateLocal||record.departureDate;
  if(!flight_no||!origin||!iso(date))throw Error('Cannot identify dated flight event');
  return {kind:'INSTANCE',action:String(record.state||record.status||'CHANGED').toUpperCase(),flight_no,origin,destination,date,dep_time:time(dep.passengerLocalTime||dep.time?.local||dep.localTime),arr_time:time(arr.passengerLocalTime||arr.time?.local||arr.localTime),raw:record};
}
export function londonReturnAllowed(ukOut,ukBack){return LONDON.has(ukOut)?LONDON.has(ukBack):ukOut===ukBack;}
export function matchesOutbound(weekday,clock){const t=time(clock);return !!t && ((weekday===5&&t>='18:00')||(weekday===6&&t<='10:00'));}
export function matchesInbound(weekday,clock){const t=time(clock);return !!t && ((weekday===7&&t>='20:00')||(weekday===1&&t<='06:00'));}
export function nextDays(start,count){const out=[];const d=new Date(start+'T12:00:00Z');for(let i=0;i<count;i++){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}return out;}
export function candidates(rows, from, days=42, mode='weekend'){
  const start=iso(from)?from:new Date().toISOString().slice(0,10);
  const dates=nextDays(start,Math.min(365,Math.max(1,Number(days)||42)));
  const flights=[];
  for(const date of dates)for(const r of rows){if(r.state==='DELETED'||!operates(r,date))continue;const ukOrigin=UK_AIRPORTS.includes(r.origin),ukDestination=UK_AIRPORTS.includes(r.destination);if(!ukOrigin&&!ukDestination)continue;const dow=dayOfWeek(date);const accepted=mode==='all'||(ukOrigin?matchesOutbound(dow,r.dep_time):matchesInbound(dow,r.dep_time));if(accepted) flights.push({...r,date,dow,direction:ukOrigin?'OUT':'IN'});}
  return flights;
}
export function pairWeekend(flights){
  const out=flights.filter(f=>f.direction==='OUT');const back=flights.filter(f=>f.direction==='IN');const pairs=[];
  for(const a of out)for(const b of back){if(a.destination!==b.origin||!londonReturnAllowed(a.origin,b.destination)||b.date<a.date)continue;const d=(Date.parse(b.date)-Date.parse(a.date))/864e5;if(d>4)continue;pairs.push({out:a,back:b,airport:a.destination,days_between:d});}
  return pairs;
}
export function normalizeSerpApi(data){
  if(data.error)throw Error(String(data.error));
  const found=[...(data.best_flights||[]),...(data.other_flights||[])];
  return found.map(x=>({price:Number(x.price),currency:data.search_parameters?.currency||'GBP',segments:(x.flights||[]).map(f=>({flight_number:f.flight_number,from:f.departure_airport?.id,to:f.arrival_airport?.id,depart:f.departure_airport?.time,arrive:f.arrival_airport?.time})),booking_token:x.booking_token||null})).filter(x=>Number.isFinite(x.price));
}
export function extractICS(s){
  if(typeof s!=='string')throw Error('ICS required');
  const unfolded=s.replace(/\r\n[ \t]/g,'').replace(/\n[ \t]/g,'');
  const events=[];
  for(const part of unfolded.split('BEGIN:VEVENT').slice(1)){
    const t=part.split('END:VEVENT')[0];const get=k=>{const m=t.match(new RegExp('^'+k+'(?:;[^:]*)?:(.+)$','mi'));return m?.[1]?.trim()||'';};
    const date=s=>{const m=s.match(/^(\d{4})(\d{2})(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:null;};
    const rawStart=get('DTSTART'),rawEnd=get('DTEND');const start=date(rawStart);if(!start)continue;
    const clock=v=>{const m=v.match(/T(\d{2})(\d{2})/);return m?m[1]+':'+m[2]:null};
    events.push({date:start,end_date:date(rawEnd)||start,start_time:clock(rawStart),end_time:clock(rawEnd),all_day:!clock(rawStart),title:get('SUMMARY').replace(/\\,/g,',').slice(0,200),status:get('STATUS')||'CONFIRMED'});
  }
  return events;
}

export function normalizeLegacyV7(r){
  const source=String(r.source||'legacy_v7');
  const daysRaw=r.weekdays_json||r.days||r.weekdays;
  let days=daysRaw;try{if(typeof daysRaw==='string'&&daysRaw.trim().startsWith('['))days=JSON.parse(daysRaw)}catch{throw Error('Invalid v7 weekdays_json')}
  const x={source,carrier:String(r.airline||r.carrier||'').toUpperCase(),flight_no:String(r.flight||r.flight_no||'').toUpperCase(),origin:iata(r.origin),destination:iata(r.destination),dep_time:time(r.departure_time||r.dep_time),arr_time:time(r.arrival_time||r.arr_time),days:weekdays(days),valid_from:r.valid_from||null,valid_to:r.valid_to||null,validity:r.validity||((r.valid_from&&r.valid_to)?'DATE_RANGE':'UNKNOWN_SEASON'),arrival_offset:r.arrival_day_offset??null,service_type:r.service_type||'',state:r.state||'ACTIVE'};
  if(!x.carrier||!x.flight_no||!/^[A-Z]{3}$/.test(x.origin)||!/^[A-Z]{3}$/.test(x.destination)||!x.dep_time||!x.days.length)throw Error('Invalid v7 schedule row');
  return x;
}
