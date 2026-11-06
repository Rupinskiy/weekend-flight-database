import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import worker,{encrypt,decrypt} from '../src/worker.mjs';
function envFactory(){const database=new DatabaseSync(':memory:');return {ADMIN_PASSWORD:'correct-long-password',SESSION_SECRET:'extremely-long-session-secret-for-tests',ENCRYPTION_SECRET:'extremely-long-encryption-secret-for-tests',DB:{prepare(q){const p=database.prepare(q);return {bind(...args){return {run(){return p.run(...args)},all(){return {results:p.all(...args)}},first(){return p.get(...args)}}},run(){return p.run()},all(){return {results:p.all()}},first(){return p.get()}}}},db:database,ASSETS:{fetch:()=>new Response('asset')}};}
async function login(e){const req=new Request('https://example.com/api/login',{method:'POST',headers:{'content-type':'application/json',Origin:'https://example.com'},body:JSON.stringify({password:'correct-long-password'})});const r=await worker.fetch(req,e,{});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
function req(p,method='GET',body,cookie){return new Request('https://example.com/api'+p,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{}),Origin:'https://example.com'},body:body?JSON.stringify(body):undefined})}
async function fetchJson(e,r){const resp=await worker.fetch(r,e,{});return [resp.status,await resp.json()]}
test('Unauthorized API requests denied',async()=>{const e=envFactory();const [s]=await fetchJson(e,req('/summary'));assert.equal(s,401)});
test('Valid login then D1 tables created',async()=>{const e=envFactory(),cookie=await login(e);const [s,data]=await fetchJson(e,req('/summary','GET',null,cookie));assert.equal(s,200);assert.equal(data.rules,0);assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n>=10,true)});
test('Profile key encrypted in database and redacted on read',async()=>{const e=envFactory(),cookie=await login(e);const key='test-api-key-123';let [s]=await fetchJson(e,req('/profiles','POST',{provider:'airlabs',owner:'Anna',plan:'Free',key,quota:20,consent:true},cookie));assert.equal(s,200);const raw=e.db.prepare('SELECT secret_enc FROM profiles').get().secret_enc;assert.equal(raw.includes(key),false);[s]=await fetchJson(e,req('/profiles','GET',null,cookie));assert.equal(s,200);const data=(await fetchJson(e,req('/profiles','GET',null,cookie)))[1];assert.ok(!JSON.stringify(data).includes(key));});
test('Secrets can round trip with AES-GCM',async()=>{const secret='long-encryption-entropy-12345678',cipher=await encrypt('abc123',secret);assert.notEqual(cipher,'abc123');assert.equal(await decrypt(cipher,secret),'abc123')});
test('Unauthorized cross-origin mutation denied',async()=>{const e=envFactory(),cookie=await login(e);const r=new Request('https://example.com/api/profiles',{method:'POST',headers:{origin:'https://evil.example',cookie,'content-type':'application/json'},body:'{}'});const [s]=await fetchJson(e,r);assert.equal(s,403)});
test('A properly signed session expires and invalid token denied',async()=>{const e=envFactory(),cookie=await login(e);const modified=cookie.slice(0,-4)+'AAAA';const [s]=await fetchJson(e,req('/summary','GET',null,modified));assert.equal(s,401)});
test('OAG import stores season accurately, duplicate idempotent',async()=>{const e=envFactory(),cookie=await login(e);const row={carrier:'BA',flightNumber:12,departure:{airport:'LHR',passengerLocalTime:'2030'},arrival:{airport:'FCO',passengerLocalTime:'0030'},legDaysOfOperation:'0000100',startDate:'2026-11-01',endDate:'2027-03-31'};for(let i=0;i<2;i++){const [s,data]=await fetchJson(e,req('/oag/import','POST',[row],cookie));assert.equal(s,200);assert.equal(data.rejected,0);}const [s,v]=await fetchJson(e,req('/schedules','GET',null,cookie));assert.equal(s,200);assert.equal(v.rules.length,1);assert.equal(v.rules[0].validity,'DATE_RANGE')});
test('OAG dated cancellation creates exception not deleting weekly schedule',async()=>{const e=envFactory(),cookie=await login(e);const event={flightNumber:'BA12',state:'CANCELLED',departure:{airport:'LHR',date:'2026-11-06',passengerLocalTime:'20:30'},arrival:{airport:'FCO'}};const [s,data]=await fetchJson(e,req('/oag/delta','POST',[event],cookie));assert.equal(s,200);assert.equal(data.results[0].kind,'INSTANCE');const [s2,summary]=await fetchJson(e,req('/summary','GET',null,cookie));assert.equal(s2,200);assert.equal(summary.exceptions,1)});
test('OAG webhook rejects unauthenticated events',async()=>{const e=envFactory();const r=new Request('https://example.com/webhooks/oag',{method:'POST',headers:{'content-type':'application/json'},body:'[]'});const result=await worker.fetch(r,e,{});assert.equal(result.status,401)});
test('Scan queue accepts all airports without date fanout',async()=>{const e=envFactory(),cookie=await login(e);let [s]=await fetchJson(e,req('/jobs/enqueue','POST',{airports:['STN','LGW']},cookie));assert.equal(s,200);const j=(await fetchJson(e,req('/jobs','GET',null,cookie)))[1].jobs;assert.equal(j.length,4)});
test('Live mocked AirLabs page, complete scope and quota accounting',async()=>{
 const e=envFactory(),cookie=await login(e);
 const profile=(await fetchJson(e,req('/profiles','POST',{provider:'airlabs',owner:'Sasha',plan:'free',quota:1,key:'key-airlabs',consent:true},cookie)))[1];
 await fetchJson(e,req('/jobs/enqueue','POST',{airports:['STN']},cookie));const saved=globalThis.fetch;
 globalThis.fetch=async u=>new Response(JSON.stringify({response:[{dep_iata:'STN',arr_iata:'FCO',airline_iata:'FR',flight_iata:'FR100',dep_time:'2015',arr_time:'2355',days:'5'}],request:{has_more:false}}),{status:200,headers:{'content-type':'application/json'}});
 try{const [status,data]=await fetchJson(e,req('/jobs/tick','POST',{profile_id:profile.id},cookie));assert.equal(status,200);assert.equal(data.status,'COMMITTING');await fetchJson(e,req('/jobs/tick','POST',{},cookie));const [finalStatus,finalData]=await fetchJson(e,req('/jobs/tick','POST',{},cookie));assert.equal(finalData.status,'COMPLETE');const summary=(await fetchJson(e,req('/summary','GET',null,cookie)))[1];assert.equal(summary.rules,1);const ps=(await fetchJson(e,req('/profiles','GET',null,cookie)))[1].profiles;assert.equal(ps[0].used,1);
 const [secondStatus]=await fetchJson(e,req('/jobs/tick','POST',{profile_id:profile.id},cookie));assert.equal(secondStatus,400);
 }finally{globalThis.fetch=saved;}
});
test('OAG schedule live mocked page and complete coverage',async()=>{
 const e=envFactory(),cookie=await login(e);await fetchJson(e,req('/profiles','POST',{provider:'oag',owner:'Family',plan:'trial',quota:2,key:'oag-key',consent:true},cookie));
 let [s,j]=await fetchJson(e,req('/oag/enqueue','POST',{airports:['STN'],from:'2026-11-01',to:'2026-11-30'},cookie));assert.equal(s,200);assert.equal(j.enqueued,2);
 const raw={carrier:'FR',flightNumber:100,departure:{airport:'STN',passengerLocalTime:'2015'},arrival:{airport:'FCO',passengerLocalTime:'2355'},legDaysOfOperation:'0000100',startDate:'2026-11-01',endDate:'2026-11-30'};
 const saved=globalThis.fetch;globalThis.fetch=async (requestUrl,opts)=>{const u=new URL(requestUrl);assert.equal(u.origin,'https://api.oag.com');assert.equal(u.pathname,'/flights');assert.equal(u.searchParams.get('DepartureAirport'),'STN');assert.equal(u.searchParams.get('DepartureDate'),'2026-11-01');assert.equal(u.searchParams.get('ToDate'),'2026-11-30');assert.equal(opts.headers['Subscription-Key'],'oag-key');return new Response(JSON.stringify({data:[raw],paging:{}}),{status:200,headers:{'content-type':'application/json'}})};
 try{const [stat,result]=await fetchJson(e,req('/oag/tick','POST',{},cookie));assert.equal(stat,200);assert.equal(result.status,'COMMITTING');await fetchJson(e,req('/oag/tick','POST',{},cookie));const [finalStatus,finalData]=await fetchJson(e,req('/oag/tick','POST',{},cookie));assert.equal(finalData.status,'DONE');const c=(await fetchJson(e,req('/coverage','GET',null,cookie)))[1];assert.ok(c.coverage.find(x=>x.provider==='oag'&&x.status==='COMPLETE'));}finally{globalThis.fetch=saved}
});
test('Signed OAG webhook authenticates, deduplicates delivery IDs',async()=>{
 const e=envFactory();const key=new TextEncoder().encode('test-oag-webhook-secret'),ts=Math.floor(Date.now()/1000).toString(),wid='webhook-123';e.OAG_WEBHOOK_SIGNING_KEY='whsec_'+btoa(String.fromCharCode(...key));
 const events=[{carrier:'FR',flightNumber:1234,departure:{airport:'STN',date:'2026-11-06',passengerLocalTime:'20:10'},arrival:{airport:'FCO'},state:'CANCELLED'}];
 const str=JSON.stringify(events),input=`${wid}.${ts}.${str}`;const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(input)))));
 const r=()=>new Request('https://example.com/webhooks/oag',{method:'POST',headers:{'content-type':'application/json','webhook-id':wid,'webhook-timestamp':ts,'webhook-signature':'v1,'+signature},body:str});
 const a=await worker.fetch(r(),e,{});assert.equal(a.status,200);const b=await worker.fetch(r(),e,{});const j=await b.json();assert.equal(j.duplicate,true);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM schedule_exceptions').get().n,1);
});
test('V7 JSON rows migrate into D1 without Python',async()=>{
 const e=envFactory(),cookie=await login(e);const row={flight:'FR300',airline:'FR',origin:'LGW',destination:'BCN',departure_time:'19:30',weekdays_json:'["fri","sun"]',source:'legacy_v7',validity:'UNVERIFIED_SEASON'};
 const [s,data]=await fetchJson(e,req('/catalog/import-v7','POST',[row],cookie));assert.equal(s,200);assert.equal(data.added,1);assert.equal(data.rejected_count,0);
});
test('All-day family ICS event blocks matching flight candidates',async()=>{
 const e=envFactory(),cookie=await login(e);const row={carrier:'FR',flightNumber:12,departure:{airport:'STN',passengerLocalTime:'20:30'},arrival:{airport:'FCO',passengerLocalTime:'23:20'},legDaysOfOperation:'0000100',startDate:'2026-11-01',endDate:'2026-11-30'};
 await fetchJson(e,req('/oag/import','POST',[row],cookie));await fetchJson(e,req('/calendar/import','POST',{person:'Sasha',ics:'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:All day exam\nDTSTART;VALUE=DATE:20261106\nDTEND;VALUE=DATE:20261106\nEND:VEVENT\nEND:VCALENDAR'},cookie));
 const result=(await fetchJson(e,req('/candidates?from=2026-11-06&days=1&mode=weekend&people=Sasha','GET',null,cookie)))[1];assert.equal(result.totalFlights,0);assert.ok(result.calendarBlocks>0);
});
test('Free-tier AirLabs uses staged continuation rather than writing large pages all at once',async()=>{
 const e=envFactory(),cookie=await login(e);
 await fetchJson(e,req('/profiles','POST',{provider:'airlabs',owner:'Family',plan:'free',quota:2,key:'mock',consent:true},cookie));
 await fetchJson(e,req('/jobs/enqueue','POST',{airports:['STN']},cookie));
 let count=0,queries=0;const prepare=e.DB.prepare.bind(e.DB);
 e.DB.prepare=q=>{queries++;return prepare(q)};
 const old=globalThis.fetch;
 globalThis.fetch=async()=>{const rowCount=count++===0?15:8;const rows=Array.from({length:rowCount},(_,i)=>({dep_iata:'STN',arr_iata:'FCO',airline_iata:'FR',flight_iata:`FR${count*100+i}`,dep_time:'2015',arr_time:'2355',days:'5'}));return new Response(JSON.stringify({response:rows,request:{has_more:count===1}}),{status:200})};
 try{
  const calls=[];for(let t=0;t<15;t++){queries=0;const [status,data]=await fetchJson(e,req('/jobs/tick','POST',{},cookie));calls.push([data.status,queries]);assert.equal(status,200);assert.ok(queries<=33,`Exceeded Free safety headroom: ${queries} D1 queries`);if(data.status==='COMPLETE')break}
  assert.equal(calls.at(-1)[0],'COMPLETE');assert.equal((await fetchJson(e,req('/summary','GET',null,cookie)))[1].rules,23);
  assert.equal((await fetchJson(e,req('/profiles','GET',null,cookie)))[1].profiles[0].used,2);
 }finally{globalThis.fetch=old}
});
test('Large OAG schedule pages stage once then commit in tiny SQL batches',async()=>{
 const e=envFactory(),cookie=await login(e);
 await fetchJson(e,req('/profiles','POST',{provider:'oag',owner:'Family',plan:'trial',quota:1,key:'mock',consent:true},cookie));
 await fetchJson(e,req('/oag/enqueue','POST',{airports:['STN'],from:'2026-11-01',to:'2027-03-30'},cookie));
 const rows=Array.from({length:100},(_,i)=>({carrier:'FR',flightNumber:1000+i,departure:{airport:'STN',passengerLocalTime:'2015'},arrival:{airport:'FCO',passengerLocalTime:'2355'},legDaysOfOperation:'0000100',startDate:'2026-11-01',endDate:'2027-03-30'}));
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({data:rows,paging:{}}),{status:200});
 try{
  const [s,r]=await fetchJson(e,req('/oag/tick','POST',{},cookie));assert.equal(r.status,'COMMITTING');
  let complete=false;for(let i=0;i<25;i++){const [st,x]=await fetchJson(e,req('/oag/tick','POST',{},cookie));assert.equal(st,200);if(x.status==='DONE'){complete=true;break;}}
  assert.ok(complete);const summary=(await fetchJson(e,req('/summary','GET',null,cookie)))[1];assert.equal(summary.rules,100);
  const prof=(await fetchJson(e,req('/profiles','GET',null,cookie)))[1].profiles[0];assert.equal(prof.used,1);
 }finally{globalThis.fetch=old}
});
test('Large signed-style delta import queued and drained without losing history',async()=>{
 const e=envFactory(),cookie=await login(e);
 const events=Array.from({length:20},(_,i)=>({flightNumber:'FR'+(300+i),state:'CANCELLED',departure:{airport:'STN',date:'2026-11-06',passengerLocalTime:'20:30'},arrival:{airport:'FCO'}}));
 const [s,data]=await fetchJson(e,req('/oag/delta','POST',events,cookie));assert.equal(s,200);assert.equal(data.queued,20);
 for(let i=0;i<5;i++)await worker.scheduled({},e,{});
 const summary=(await fetchJson(e,req('/summary','GET',null,cookie)))[1];assert.equal(summary.exceptions,20);
});
