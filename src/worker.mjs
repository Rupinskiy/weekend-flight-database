import {UK_AIRPORTS,LONDON,normalizeAirLabs,normalizeOAG,normalizeOAGDelta,normalizeSerpApi,operates,candidates,pairWeekend,extractICS,iso,normalizeLegacyV7} from './core.mjs';

const TABLES=[
`CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,provider TEXT NOT NULL,owner TEXT NOT NULL,plan TEXT NOT NULL DEFAULT '',secret_enc TEXT NOT NULL,quota INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0,quota_group TEXT NOT NULL DEFAULT '',group_limit INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 1,consent INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '',expires_at TEXT,updated_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS schedule_rules(id TEXT PRIMARY KEY,source TEXT,carrier TEXT,flight_no TEXT,origin TEXT,destination TEXT,dep_time TEXT,arr_time TEXT,days_json TEXT,valid_from TEXT,valid_to TEXT,validity TEXT,arrival_offset INTEGER,service_type TEXT,state TEXT DEFAULT 'ACTIVE',hash TEXT,version INTEGER DEFAULT 1,last_seen TEXT)`,
`CREATE TABLE IF NOT EXISTS schedule_revisions(id INTEGER PRIMARY KEY AUTOINCREMENT,rule_id TEXT NOT NULL,changed_at TEXT NOT NULL,action TEXT NOT NULL,old_json TEXT,new_json TEXT,origin_event TEXT)`,
`CREATE TABLE IF NOT EXISTS schedule_exceptions(id TEXT PRIMARY KEY,source TEXT,flight_no TEXT,origin TEXT,destination TEXT,flight_date TEXT,dep_time TEXT,arr_time TEXT,action TEXT,verified INTEGER DEFAULT 0,raw_json TEXT,updated_at TEXT)`,
`CREATE TABLE IF NOT EXISTS delta_events(id TEXT PRIMARY KEY,received_at TEXT NOT NULL,source TEXT NOT NULL,kind TEXT NOT NULL,event_json TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS scan_jobs(id TEXT PRIMARY KEY,provider TEXT,airport TEXT,direction TEXT,offset INTEGER DEFAULT 0,items_seen INTEGER DEFAULT 0,status TEXT DEFAULT 'PENDING',last_error TEXT DEFAULT '',updated_at TEXT,completed_at TEXT)`,
`CREATE TABLE IF NOT EXISTS scan_staging(job_id TEXT,record_hash TEXT,rule_json TEXT,PRIMARY KEY(job_id,record_hash))`,
`CREATE TABLE IF NOT EXISTS oag_staging(job_id TEXT,record_hash TEXT,rule_json TEXT,PRIMARY KEY(job_id,record_hash))`,
`CREATE TABLE IF NOT EXISTS delta_queue(event_id TEXT,idx INTEGER,event_json TEXT,PRIMARY KEY(event_id,idx))`,
`CREATE TABLE IF NOT EXISTS oag_jobs(id TEXT PRIMARY KEY,airport TEXT,direction TEXT,date_from TEXT,date_to TEXT,next_url TEXT,records INTEGER DEFAULT 0,status TEXT DEFAULT 'PENDING',last_error TEXT DEFAULT '',updated_at TEXT)`,
`CREATE TABLE IF NOT EXISTS coverage(id TEXT PRIMARY KEY,provider TEXT,airport TEXT,direction TEXT,status TEXT,rows INTEGER,last_checked TEXT,notes TEXT)`,
`CREATE TABLE IF NOT EXISTS price_observations(id INTEGER PRIMARY KEY AUTOINCREMENT,watch_id TEXT,observed_at TEXT,amount REAL,currency TEXT,segments_json TEXT,booking_token TEXT)`,
`CREATE TABLE IF NOT EXISTS price_watches(id TEXT PRIMARY KEY,origin TEXT,destination TEXT,date TEXT,passengers INTEGER DEFAULT 1,target REAL NOT NULL DEFAULT 0,currency TEXT DEFAULT 'GBP',last_amount REAL,last_checked TEXT,enabled INTEGER DEFAULT 1)`,
`CREATE TABLE IF NOT EXISTS calendar_events(id TEXT PRIMARY KEY,person TEXT,date TEXT,end_date TEXT,start_time TEXT,end_time TEXT,all_day INTEGER DEFAULT 0,title TEXT,kind TEXT,source TEXT,updated_at TEXT)`,
`CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,action TEXT,detail TEXT)`,
`CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT)`,
`CREATE TABLE IF NOT EXISTS login_limits(ip TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,window_start TEXT NOT NULL)`
];
const initialized=new WeakSet();
const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
const enc=new TextEncoder();
function toBase64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes)));}
function fromBase64(text){return Uint8Array.from(atob(text),x=>x.charCodeAt(0));}
async function digest(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function hmac(key,msg){const k=await crypto.subtle.importKey('raw',enc.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return toBase64(await crypto.subtle.sign('HMAC',k,enc.encode(msg)));}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;let diff=a.length^b.length;const max=Math.max(a.length,b.length);for(let i=0;i<max;i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
async function secretKey(secret){if(!secret||secret.length<24)throw Error('ENCRYPTION_SECRET must be >=24 characters');return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode(secret)),'AES-GCM',false,['encrypt','decrypt']);}
export async function encrypt(value,secret){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await secretKey(secret),enc.encode(value));return toBase64(iv)+'.'+toBase64(data);}
export async function decrypt(value,secret){const [a,b]=value.split('.');const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(a)},await secretKey(secret),fromBase64(b));return new TextDecoder().decode(plain);}
async function setup(env){if(initialized.has(env.DB))return;for(const t of TABLES)await env.DB.prepare(t).run();initialized.add(env.DB);}
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
async function body(req,max=1000000){if(Number(req.headers.get('content-length')||0)>max)throw Error('Request too large');const s=await req.text();if(s.length>max)throw Error('Request too large');return JSON.parse(s||'{}');}
function cookie(req){const h=req.headers.get('cookie')||'';return h.split(';').map(x=>x.trim()).find(x=>x.startsWith('wfd_session='))?.slice('wfd_session='.length)||'';}
async function authorized(req,env){if(!env.SESSION_SECRET)return false;const v=cookie(req).split('.');if(v.length!==2)return false;const [exp,sig]=v;if(!/^\d+$/.test(exp)||Number(exp)<Date.now())return false;return equal(sig,await hmac(env.SESSION_SECRET,exp));}
function sameOrigin(req){const origin=req.headers.get('Origin');return !origin||origin===new URL(req.url).origin;}
const sql=(env,q,...args)=>env.DB.prepare(q).bind(...args);
async function audit(env,action,detail=''){await sql(env,'INSERT INTO audit(at,action,detail) VALUES(?,?,?)',now(),action,String(detail).slice(0,700)).run();}
async function all(env,q,...args){return (await sql(env,q,...args).all()).results||[];}
async function first(env,q,...args){return await sql(env,q,...args).first();}
async function saveRule(env,r,eventId=''){const normalized={...r,days:r.days||[]};const key=[r.source,r.carrier,r.flight_no,r.origin,r.destination,r.valid_from||'',r.valid_to||''].join('|');const pk=await digest(key);const hash=await digest(JSON.stringify(normalized));const old=await first(env,'SELECT * FROM schedule_rules WHERE id=?',pk);if(old?.hash===hash)return 'UNCHANGED';
  if(old)await sql(env,'INSERT INTO schedule_revisions(rule_id,changed_at,action,old_json,new_json,origin_event) VALUES(?,?,?,?,?,?)',pk,now(),'UPDATED',JSON.stringify(old),JSON.stringify(normalized),eventId).run();
  else await sql(env,'INSERT INTO schedule_revisions(rule_id,changed_at,action,old_json,new_json,origin_event) VALUES(?,?,?,?,?,?)',pk,now(),'ADDED',null,JSON.stringify(normalized),eventId).run();
  await sql(env,`INSERT INTO schedule_rules(id,source,carrier,flight_no,origin,destination,dep_time,arr_time,days_json,valid_from,valid_to,validity,arrival_offset,service_type,state,hash,version,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET dep_time=excluded.dep_time,arr_time=excluded.arr_time,days_json=excluded.days_json,arrival_offset=excluded.arrival_offset,service_type=excluded.service_type,state=excluded.state,hash=excluded.hash,version=schedule_rules.version+1,last_seen=excluded.last_seen`,pk,r.source,r.carrier,r.flight_no,r.origin,r.destination,r.dep_time||'',r.arr_time||'',JSON.stringify(r.days),r.valid_from,r.valid_to,r.validity||'',r.arrival_offset,r.service_type||'',r.state||'ACTIVE',hash,1,now()).run();return old?'UPDATED':'ADDED';}
async function applyDelta(env,e,eventId){const d=normalizeOAGDelta(e);if(d.kind==='RULE'){
  const r=d.rule;const action=d.action;if(/CANCEL|DELETE|REMOVE|WITHDRAW/.test(action))r.state='DELETED';
  return {kind:'RULE',result:await saveRule(env,r,eventId)};
}
const x=d;const k=await digest([x.flight_no,x.origin,x.date].join('|'));
await sql(env,`INSERT INTO schedule_exceptions(id,source,flight_no,origin,destination,flight_date,dep_time,arr_time,action,verified,raw_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET destination=excluded.destination,dep_time=excluded.dep_time,arr_time=excluded.arr_time,action=excluded.action,verified=excluded.verified,raw_json=excluded.raw_json,updated_at=excluded.updated_at`,k,'oag',x.flight_no,x.origin,x.destination,x.date,x.dep_time,x.arr_time,x.action,1,JSON.stringify(x.raw).slice(0,20000),now()).run();return {kind:'INSTANCE',result:'UPSERT'};
}
async function processEvents(env,events,source='oag',eventId=id()){
 if(!Array.isArray(events)||events.length>100)throw Error('Expected array of <=100 delta messages');
 const old=await first(env,'SELECT id FROM delta_events WHERE id=?',eventId);
 if(old)return {duplicate:true,received:events.length};
 // Large vendor batches are queued to respect Cloudflare Free's 50 D1-query/invocation limit.
 if(events.length>4){
   for(let at=0;at<events.length;at+=25){const group=events.slice(at,at+25);const args=[];
     const values=group.map((item,i)=>{args.push(eventId,at+i,JSON.stringify(item));return '(?,?,?)'}).join(',');
     await sql(env,'INSERT OR IGNORE INTO delta_queue(event_id,idx,event_json) VALUES '+values,...args).run();
   }
   await sql(env,'INSERT INTO delta_events(id,received_at,source,kind,event_json) VALUES(?,?,?,?,?)',eventId,now(),source,'QUEUED',JSON.stringify(events).slice(0,750000)).run();
   return {received:events.length,queued:events.length,results:[]};
 }
 const result=[];
 for(const [i,e] of events.entries())result.push(await applyDelta(env,e,eventId+':'+i));
 await sql(env,'INSERT INTO delta_events(id,received_at,source,kind,event_json) VALUES(?,?,?,?,?)',eventId,now(),source,'BATCH',JSON.stringify(events).slice(0,750000)).run();
 return {received:result.length,results:result};
}
async function drainDeltaQueue(env){
 const jobs=await all(env,'SELECT event_id,idx,event_json FROM delta_queue ORDER BY event_id,idx LIMIT 5');
 for(const j of jobs){await applyDelta(env,JSON.parse(j.event_json),j.event_id+':'+j.idx);
 await sql(env,'DELETE FROM delta_queue WHERE event_id=? AND idx=?',j.event_id,j.idx).run();}
 return jobs.length;
}
async function verifyOAGSignature(req,text,env){
  // Verify Standard Webhooks signature; signed raw bytes must not be transformed.
  let secret=env.OAG_WEBHOOK_SIGNING_KEY;
  if(!secret){const row=await first(env,"SELECT secret_enc FROM profiles WHERE provider='oag_webhook' AND enabled=1 AND consent=1 ORDER BY updated_at DESC LIMIT 1");if(row)secret=await decrypt(row.secret_enc,env.ENCRYPTION_SECRET);}
  if(secret){const wId=req.headers.get('webhook-id'),ts=req.headers.get('webhook-timestamp'),sigs=req.headers.get('webhook-signature')||'';
    if(!wId||!/^\d+$/.test(ts||'')||Math.abs(Date.now()/1000-Number(ts))>300)return false;
    const raw=secret.startsWith('whsec_')?fromBase64(secret.slice(6)):enc.encode(secret);
    const key=await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign']);const actual=toBase64(await crypto.subtle.sign('HMAC',key,enc.encode(wId+'.'+ts+'.'+text)));
    return sigs.split(/\s+/).some(v=>v.startsWith('v1,')&&equal(v.slice(3),actual));
  }
  if(!env.OAG_WEBHOOK_KEY)return false;
  return equal(req.headers.get('x-api-key')||'',env.OAG_WEBHOOK_KEY);
}
async function profiles(env){return all(env,'SELECT id,provider,owner,plan,quota,used,quota_group,group_limit,enabled,consent,notes,expires_at,updated_at FROM profiles ORDER BY provider,owner');}
async function chooseProfile(env,provider,preferred,cost=1){const records=await all(env,'SELECT * FROM profiles WHERE provider=? AND enabled=1 AND consent=1 ORDER BY updated_at DESC',provider);const selected=preferred?records.filter(x=>x.id===preferred):records;
 for(const p of selected){if(p.expires_at&&p.expires_at<now().slice(0,10))continue;if(p.quota<=0||p.used+cost>p.quota)continue;
  if(p.quota_group&&p.group_limit>0){const total=await first(env,'SELECT sum(used) as n FROM profiles WHERE provider=? AND quota_group=?',provider,p.quota_group);if(Number(total?.n||0)+cost>p.group_limit)continue;}
  return {...p,secret:await decrypt(p.secret_enc,env.ENCRYPTION_SECRET)};
 }throw Error('No active authorized profile with remaining budget');}
async function incrementUsage(env,p,n=1){await sql(env,'UPDATE profiles SET used=used+?,updated_at=? WHERE id=?',n,now(),p.id).run();}
async function callAirLabs(env,p,airport,direction,offset=0){const u=new URL('https://airlabs.co/api/v9/routes');u.searchParams.set('api_key',p.secret);u.searchParams.set(direction==='OUT'?'dep_iata':'arr_iata',airport);u.searchParams.set('limit','15');u.searchParams.set('offset',String(offset));
 const response=await fetch(u,{headers:{accept:'application/json'}});await incrementUsage(env,p);if(!response.ok)throw Error(`AirLabs HTTP ${response.status}`);const v=await response.json();if(v.error)throw Error('AirLabs provider error');if(!Array.isArray(v.response))throw Error('Unexpected AirLabs response');return {rows:v.response,has_more:v.request?.has_more};}
async function enqueueAirLabs(env,airports){let count=0;for(const a of airports){if(!UK_AIRPORTS.includes(a))continue;for(const dir of ['OUT','IN']){const jobId=`airlabs:${a}:${dir}`;await sql(env,`INSERT OR IGNORE INTO scan_jobs(id,provider,airport,direction,offset,status,updated_at) VALUES(?,?,?,?,0,'PENDING',?)`,jobId,'airlabs',a,dir,now()).run();count++;}}return count;}
async function finalizeAirLabs(env,j){
 const entries=await all(env,'SELECT record_hash,rule_json FROM scan_staging WHERE job_id=? LIMIT 5',j.id);
 for(const x of entries){await saveRule(env,JSON.parse(x.rule_json));
   await sql(env,'DELETE FROM scan_staging WHERE job_id=? AND record_hash=?',j.id,x.record_hash).run();}
 if(entries.length){await sql(env,'UPDATE scan_jobs SET items_seen=items_seen+?,updated_at=? WHERE id=?',entries.length,now(),j.id).run();
   return {status:'COMMITTING',job:j.id,saved:entries.length};}
 if(!j.items_seen){await sql(env,"UPDATE scan_jobs SET status='ERROR',last_error='Empty result needs review',updated_at=? WHERE id=?",now(),j.id).run();return {status:'REVIEW_EMPTY',job:j.id};}
 const verifiedComplete=!j.last_error;
 await sql(env,"UPDATE scan_jobs SET offset=0,status=?,completed_at=?,updated_at=? WHERE id=?",verifiedComplete?'DONE':'INCOMPLETE',now(),now(),j.id).run();
 await sql(env,`INSERT INTO coverage(id,provider,airport,direction,status,rows,last_checked,notes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,rows=excluded.rows,last_checked=excluded.last_checked,notes=excluded.notes`,j.id,'airlabs',j.airport,j.direction,verifiedComplete?'COMPLETE':'INCOMPLETE',j.items_seen,now(),j.last_error||'All pagination and commit batches complete').run();
 return {status:verifiedComplete?'COMPLETE':'INCOMPLETE',job:j.id,saved:j.items_seen};
}
async function scanTick(env,profileId,includeErrors=true){
 const condition=includeErrors?"'PENDING','ERROR','RUNNING','COMMITTING'":"'PENDING','RUNNING','COMMITTING'";
 const j=await first(env,`SELECT * FROM scan_jobs WHERE status IN (${condition}) ORDER BY airport, CASE direction WHEN 'OUT' THEN 0 ELSE 1 END LIMIT 1`);
 if(!j)return {message:'No pending jobs'};
 if(j.status==='COMMITTING')return finalizeAirLabs(env,j);
 const p=await chooseProfile(env,'airlabs',profileId);
 try{const v=await callAirLabs(env,p,j.airport,j.direction,j.offset);let accepted=0,rejected=0;
   for(const row of v.rows){if(String(row[j.direction==='OUT'?'dep_iata':'arr_iata']||'').toUpperCase()!==j.airport)continue;
     try{const rule=normalizeAirLabs(row);const hash=await digest(JSON.stringify(rule));
     await sql(env,'INSERT OR IGNORE INTO scan_staging(job_id,record_hash,rule_json) VALUES(?,?,?)',j.id,hash,JSON.stringify(rule)).run();accepted++;}catch{rejected++;}}
   const next=j.offset+v.rows.length;
   const complete=v.has_more===false||(v.has_more==null&&v.rows.length<15);
   if(v.has_more===true&&!v.rows.length)throw Error('Incomplete page (zero rows but has_more=true)');
   await sql(env,"UPDATE scan_jobs SET offset=?,status=?,last_error=?,updated_at=? WHERE id=?",next,complete?'COMMITTING':'RUNNING',rejected?((j.last_error||'')+'; invalid rows: '+rejected).slice(0,250):j.last_error||'',now(),j.id).run();
   return {status:complete?'COMMITTING':'RUNNING',job:j.id,fetched:v.rows.length,accepted,rejected,next};
 }catch(e){await sql(env,"UPDATE scan_jobs SET status='ERROR',last_error=?,updated_at=? WHERE id=?",String(e.message).slice(0,250),now(),j.id).run();throw e;}
}
async function enqueueOAG(env,x){
  const ports=(Array.isArray(x.airports)?x.airports:[]).map(a=>String(a).toUpperCase()).filter(a=>UK_AIRPORTS.includes(a));
  if(!ports.length||ports.length>20||!iso(x.from)||!iso(x.to)||x.from>x.to)throw Error('Valid airports and date range required');
  // OAG schedules entitlement/range caps depend on plan. Date ranges are adjustable in the UI.
  let created=0;for(const p of ports)for(const dir of ['OUT','IN']){
    const pk=`oag:${p}:${dir}:${x.from}:${x.to}`;
    await sql(env,"INSERT OR IGNORE INTO oag_jobs(id,airport,direction,date_from,date_to,status,updated_at) VALUES(?,?,?,?,?,'PENDING',?)",pk,p,dir,x.from,x.to,now()).run();created++;
  }return {enqueued:created,notice:'Each job pages using provider next link. Full coverage only after last page.'};
}
async function finalizeOAG(env,j){
 const entries=await all(env,'SELECT record_hash,rule_json FROM oag_staging WHERE job_id=? LIMIT 5',j.id);
 for(const x of entries){await saveRule(env,JSON.parse(x.rule_json));
 await sql(env,'DELETE FROM oag_staging WHERE job_id=? AND record_hash=?',j.id,x.record_hash).run();}
 if(entries.length){await sql(env,'UPDATE oag_jobs SET records=records+?,updated_at=? WHERE id=?',entries.length,now(),j.id).run();
 return {job:j.id,status:'COMMITTING',saved:entries.length};}
 const verifiedComplete=!j.last_error;
 await sql(env,"UPDATE oag_jobs SET status=?,updated_at=? WHERE id=?",verifiedComplete?'DONE':'INCOMPLETE',now(),j.id).run();
 if(!j.id.startsWith('import:'))await sql(env,`INSERT INTO coverage(id,provider,airport,direction,status,rows,last_checked,notes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,rows=excluded.rows,last_checked=excluded.last_checked,notes=excluded.notes`,j.id,'oag',j.airport,j.direction,verifiedComplete?'COMPLETE':'INCOMPLETE',j.records,now(),j.last_error||j.date_from+'..'+j.date_to).run();
 return {job:j.id,status:verifiedComplete?'DONE':'INCOMPLETE',saved:j.records};
}
async function oagTick(env,profileId){
 const j=await first(env,"SELECT * FROM oag_jobs WHERE status IN ('PENDING','RUNNING','COMMITTING','ERROR') ORDER BY airport,direction LIMIT 1");
 if(!j)return {message:'No pending OAG jobs'};
 if(j.status==='COMMITTING')return finalizeOAG(env,j);
 const p=await chooseProfile(env,'oag',profileId);
 const url=new URL(j.next_url||'https://api.oag.com/schedules');
 if(url.protocol!=='https:'||url.hostname!=='api.oag.com'||!url.pathname.startsWith('/schedules'))throw Error('Invalid OAG pagination target');
 if(!j.next_url){url.searchParams.set(j.direction==='OUT'?'DepartureAirport':'ArrivalAirport',j.airport);url.searchParams.set('DepartureDate',j.date_from+'/'+j.date_to);url.searchParams.set('CodeType','IATA');url.searchParams.set('Limit','100');url.searchParams.set('version','v1');}
 const response=await fetch(url,{headers:{'Subscription-Key':p.secret,Accept:'application/json'}});await incrementUsage(env,p);
 if(!response.ok){await sql(env,"UPDATE oag_jobs SET status='ERROR',last_error=?,updated_at=? WHERE id=?",'HTTP '+response.status,now(),j.id).run();throw Error('OAG HTTP '+response.status+' — verify subscription entitlement');}
 const data=await response.json();const rows=Array.isArray(data)?data:(data.data||data.response||data.schedules||data.items||[]);
 if(!Array.isArray(rows))throw Error('Unexpected OAG response');
 const bad=[];const accepted=[];
 for(const [i,row] of rows.entries())try{const normalized=normalizeOAG(row);accepted.push([await digest(JSON.stringify(normalized)),JSON.stringify(normalized)]);}catch(e){bad.push({index:i,reason:e.message});}
 for(let at=0;at<accepted.length;at+=25){const chunk=accepted.slice(at,at+25),args=[];
  const placeholders=chunk.map(([h,r])=>{args.push(j.id,h,r);return '(?,?,?)'}).join(',');
  await sql(env,'INSERT OR IGNORE INTO oag_staging(job_id,record_hash,rule_json) VALUES '+placeholders,...args).run();}
 const next=data.paging?.next||data.pagination?.next||null;
 if(next){const u=new URL(next,url);if(u.protocol!=='https:'||u.hostname!=='api.oag.com'||!u.pathname.startsWith('/schedules'))throw Error('Unsafe provider next link');}
 const status=next?'RUNNING':'COMMITTING';
 const errors=[j.last_error,bad.slice(0,3).map(x=>x.reason).join(';')].filter(Boolean).join(';').slice(0,250);
 await sql(env,'UPDATE oag_jobs SET next_url=?,status=?,last_error=?,updated_at=? WHERE id=?',next,status,errors,now(),j.id).run();
 return {job:j.id,status,fetched:rows.length,accepted:accepted.length,rejected:bad.length,has_next:!!next};
}
async function stageManualRules(env,rules,source='manual'){
 const jobId='import:'+id();
 await sql(env,"INSERT INTO oag_jobs(id,airport,direction,date_from,date_to,status,updated_at) VALUES(?,?,?,?,?,'COMMITTING',?)",jobId,'','IMPORT','', '',now()).run();
 for(let at=0;at<rules.length;at+=25){const group=rules.slice(at,at+25),args=[];
  const placeholders=group.map(r=>{args.push(jobId,awaitableHashPlaceholder(r),JSON.stringify(r));return '(?,?,?)'}).join(',');
  // Hash is deterministic using source-specific normalized content; no provider calls here.
  await sql(env,'INSERT OR IGNORE INTO oag_staging(job_id,record_hash,rule_json) VALUES '+placeholders,...args).run();
 }
 return jobId;
}
// The staging key is a stable exact-string identifier, no cryptographic security property required.
function awaitableHashPlaceholder(r){return [r.source,r.carrier,r.flight_no,r.origin,r.destination,r.dep_time,r.valid_from||'',r.valid_to||''].join('|');}
async function importOAG(env,payload){let rows=Array.isArray(payload)?payload:(payload.response||payload.schedules||payload.items||payload.data||[]);
 if(!Array.isArray(rows)||rows.length>3000)throw Error('Expected OAG effective schedule array (<=3000)');
 let added=0,updated=0,errors=[],accepted=[];
 for(let i=0;i<rows.length;i++){try{accepted.push(normalizeOAG(rows[i]));}catch(e){errors.push({index:i,message:e.message});}}
 if(accepted.length<=5){for(const x of accepted){const result=await saveRule(env,x);if(result==='ADDED')added++;if(result==='UPDATED')updated++;}
   return {total:rows.length,added,updated,errors:errors.slice(0,20),rejected:errors.length};}
 const job=await stageManualRules(env,accepted,'oag');
 return {total:rows.length,queued:accepted.length,job,errors:errors.slice(0,20),rejected:errors.length,note:'Imported into staging; commit batches run via OAG tick/Cron.'};
}
async function priceSearch(env,query){const origin=String(query.origin||'').toUpperCase(),destination=String(query.destination||'').toUpperCase(),date=query.date;
 if(!/^[A-Z]{3}$/.test(origin)||!/^[A-Z]{3}$/.test(destination)||!iso(date))throw Error('Valid origin/destination/date required');const p=await chooseProfile(env,'serpapi',query.profile_id);
 const url=new URL('https://serpapi.com/search.json');Object.entries({engine:'google_flights',type:'2',departure_id:origin,arrival_id:destination,outbound_date:date,currency:'GBP',hl:'en',gl:'uk',adults:String(Math.min(8,Math.max(1,Number(query.passengers||1)))),sort_by:'2',api_key:p.secret}).forEach(([k,v])=>url.searchParams.set(k,v));
 const response=await fetch(url,{headers:{accept:'application/json'}});await incrementUsage(env,p);if(!response.ok)throw Error('SerpApi HTTP '+response.status);return normalizeSerpApi(await response.json()).slice(0,100);
}
async function verifyFlight(env,input){const flight_no=String(input.flight_no||'').trim().toUpperCase(),date=input.date;
 if(!/^[A-Z0-9]{2,4}\d{1,5}[A-Z]?$/.test(flight_no)||!iso(date))throw Error('Flight number and ISO date required');const p=await chooseProfile(env,'aerodatabox',input.profile_id,2);
 // AeroDataBox: direct, RapidAPI and API.Market may use different host/header; selectable profile metadata.
 const channel=String(p.plan||'').toLowerCase();
 const viaRapid=channel.includes('rapidapi');
 const viaMarket=channel.includes('apimarket')||channel.includes('api.market')||channel.includes('api market');
 const host=viaRapid?'https://aerodatabox.p.rapidapi.com':viaMarket?'https://prod.api.market/api/v1/aedbx/aerodatabox':'https://api.aerodatabox.com';
 const url=`${host}/flights/number/${encodeURIComponent(flight_no)}/${date}`;
 const headers=viaRapid?{'X-RapidAPI-Key':p.secret,'X-RapidAPI-Host':'aerodatabox.p.rapidapi.com'}:viaMarket?{'x-api-market-key':p.secret}:{'x-api-key':p.secret};
 const r=await fetch(url,{headers});await incrementUsage(env,p,2);if(!r.ok)throw Error('AeroDataBox HTTP '+r.status);const raw=await r.json();
 // Do not call unknown/empty/provider-partial responses verified.
 const matches=(Array.isArray(raw)?raw:[]).filter(x=>String(x.number||x.flightNumber||'').replace(/\s/g,'').toUpperCase()===flight_no || String(x.number||'').replace(/\s/g,'').toUpperCase()===flight_no);
 return {verified:matches.length>0,provider:'aerodatabox',flight_no,date,matches:matches.slice(0,10),note:matches.length?'Provider response found':'Unconfirmed; missing response is not a cancellation'};
}
function sanitizedRows(rows){return rows.map(r=>({...r,days:JSON.parse(r.days_json||'[]')}));}
export default {async fetch(req,env,ctx){try{
  const url=new URL(req.url),path=url.pathname;
  if(path.startsWith('/webhooks/oag')){await setup(env);if(req.method!=='POST')return json({error:'method'},405);const text=await req.text();if(text.length>950000)return json({error:'too large'},413);if(!await verifyOAGSignature(req,text,env))return json({error:'invalid webhook signature'},401);await setup(env);const value=JSON.parse(text);const events=Array.isArray(value)?value:[value];return json(await processEvents(env,events,'oag',req.headers.get('webhook-id')||id()));}
  if(!path.startsWith('/api/'))return env.ASSETS.fetch(req);
  if(path==='/api/health')return json({ok:!!env.DB,configured:!!(env.ADMIN_PASSWORD&&env.SESSION_SECRET&&env.ENCRYPTION_SECRET),version:'8.1.0-rc2'});
  if(path==='/api/login'&&req.method==='POST'){if(!sameOrigin(req))return json({error:'origin'},403);await setup(env);
    const ip=(req.headers.get('cf-connecting-ip')||'unknown').slice(0,80), previous=await first(env,'SELECT * FROM login_limits WHERE ip=?',ip);
    const reset=!previous||(Date.now()-Date.parse(previous.window_start)>15*60*1000);
    if(!reset&&previous.attempts>=5)return json({error:'Too many login attempts. Retry later.'},429);
    const x=await body(req);
    if(!env.ADMIN_PASSWORD||!equal(await digest(x.password||''),await digest(env.ADMIN_PASSWORD))){await sql(env,`INSERT INTO login_limits(ip,attempts,window_start) VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET attempts=?,window_start=?`,ip,1,now(),reset?1:previous.attempts+1,reset?now():previous.window_start).run();return json({error:'Invalid password'},401);}
    await sql(env,'DELETE FROM login_limits WHERE ip=?',ip).run();const expires=String(Date.now()+8*3600*1000),sig=await hmac(env.SESSION_SECRET,expires);return json({ok:true},200,{'set-cookie':`wfd_session=${expires}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`});} 
  if(!await authorized(req,env))return json({error:'Sign in required'},401);
  if(!sameOrigin(req))return json({error:'origin'},403);
  await setup(env);
  if(path==='/api/logout'&&req.method==='POST')return json({ok:true},200,{'set-cookie':'wfd_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
  if(path==='/api/summary'){const a=await first(env,'SELECT count(*) n FROM schedule_rules');const c=await first(env,'SELECT count(*) n FROM schedule_exceptions');const p=await first(env,'SELECT count(*) n FROM profiles');const j=await all(env,'SELECT status,count(*) n FROM scan_jobs GROUP BY status');return json({rules:a.n,exceptions:c.n,profiles:p.n,jobs:j});}
  if(path==='/api/profiles'&&req.method==='GET')return json({profiles:await profiles(env)});
  if(path==='/api/profiles'&&req.method==='POST'){const x=await body(req);if(!['airlabs','oag','oag_webhook','aerodatabox','serpapi','duffel','flightaware','cirium','aviationstack'].includes(x.provider))throw Error('Unknown provider');if(!x.owner||!x.key||!x.consent)throw Error('Owner, secret key and permission confirmation required');const pk=id();await sql(env,`INSERT INTO profiles(id,provider,owner,plan,secret_enc,quota,used,quota_group,group_limit,enabled,consent,notes,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,1,?,?,?)`,pk,x.provider,String(x.owner).slice(0,80),String(x.plan||'').slice(0,60),await encrypt(String(x.key),env.ENCRYPTION_SECRET),Math.max(0,Number(x.quota)||0),0,String(x.quota_group||'').slice(0,80),Math.max(0,Number(x.group_limit)||0),String(x.notes||'').slice(0,400),x.expires_at||null,now()).run();await audit(env,'ADD_PROFILE',x.provider+' / '+x.owner);return json({id:pk,stored:true});}
  if(path==='/api/profiles/toggle'&&req.method==='POST'){const x=await body(req);await sql(env,'UPDATE profiles SET enabled=? WHERE id=?',x.enabled?1:0,x.id).run();return json({ok:true});}
  if(path==='/api/profiles/reset-budget'&&req.method==='POST'){const x=await body(req);await sql(env,'UPDATE profiles SET used=0 WHERE id=?',x.id).run();await audit(env,'RESET_BUDGET',x.id);return json({ok:true});}
  if(path==='/api/profiles/replace-key'&&req.method==='POST'){const x=await body(req);if(!x.key||!x.id)throw Error('ID and new key needed');await sql(env,'UPDATE profiles SET secret_enc=?,used=0,updated_at=? WHERE id=?',await encrypt(String(x.key),env.ENCRYPTION_SECRET),now(),x.id).run();return json({ok:true});}
  if(path==='/api/jobs'&&req.method==='GET')return json({jobs:await all(env,'SELECT * FROM scan_jobs ORDER BY airport,direction LIMIT 100'),coverage:await all(env,'SELECT * FROM coverage ORDER BY airport,direction LIMIT 100')});
  if(path==='/api/jobs/enqueue'&&req.method==='POST'){const x=await body(req);return json({enqueued:await enqueueAirLabs(env,Array.isArray(x.airports)?x.airports:UK_AIRPORTS)});}
  if(path==='/api/jobs/tick'&&req.method==='POST'){const x=await body(req);return json(await scanTick(env,x.profile_id));}
  if(path==='/api/jobs/refresh'&&req.method==='POST'){await sql(env,"UPDATE scan_jobs SET status='PENDING',offset=0,items_seen=0,updated_at=? WHERE status='DONE'",now()).run();return json({ok:true});}
  if(path==='/api/oag/jobs'&&req.method==='GET')return json({jobs:await all(env,'SELECT * FROM oag_jobs ORDER BY airport,direction LIMIT 250')});
  if(path==='/api/oag/enqueue'&&req.method==='POST')return json(await enqueueOAG(env,await body(req)));
  if(path==='/api/oag/tick'&&req.method==='POST'){const x=await body(req);return json(await oagTick(env,x.profile_id));}
  if(path==='/api/catalog/import-v7'&&req.method==='POST'){const data=await body(req,1200000);if(!Array.isArray(data)||data.length>2500)throw Error('Expected <=2500 v7 CSV rows as JSON');let added=0,updated=0,rejected=[],accepted=[];for(const [i,row] of data.entries()){try{accepted.push(normalizeLegacyV7(row));}catch(e){rejected.push({row:i+1,error:e.message});}}if(accepted.length>5){const job=await stageManualRules(env,accepted,'legacy_v7');return json({total:data.length,queued:accepted.length,job,rejected:rejected.slice(0,25),rejected_count:rejected.length,note:'Staged: wait for background commit batches.'});}for(const r of accepted){const s=await saveRule(env,r);if(s==='ADDED')added++;if(s==='UPDATED')updated++;}return json({total:data.length,added,updated,rejected:rejected.slice(0,25),rejected_count:rejected.length});}
  if(path==='/api/oag/import'&&req.method==='POST')return json(await importOAG(env,await body(req,1200000)));
  if(path==='/api/oag/delta'&&req.method==='POST'){const x=await body(req);return json(await processEvents(env,Array.isArray(x)?x:(x.events||[x]),'manual',id()));}
  if(path==='/api/schedules'&&req.method==='GET'){let sqlText='SELECT * FROM schedule_rules WHERE 1=1',args=[];for(const k of ['origin','destination','carrier','source']){const v=url.searchParams.get(k);if(v){sqlText+=` AND ${k}=?`;args.push(v.toUpperCase());}}const limit=Math.min(1000,Math.max(1,Number(url.searchParams.get('limit')||1000))),offset=Math.max(0,Number(url.searchParams.get('offset')||0));sqlText+=' ORDER BY origin,destination,flight_no LIMIT ? OFFSET ?';return json({rules:sanitizedRows(await all(env,sqlText,...args,limit,offset)),offset,limit});}
  if(path==='/api/candidates'&&req.method==='GET'){const rows=sanitizedRows(await all(env,"SELECT * FROM schedule_rules WHERE state='ACTIVE' LIMIT 10000"));let allCandidates=candidates(rows,url.searchParams.get('from')||now().slice(0,10),Number(url.searchParams.get('days')||42),url.searchParams.get('mode')||'weekend');
   const people=(url.searchParams.get('people')||'').split(',').filter(x=>['Anna','Sasha','Family'].includes(x));let calendarBlocks=0;
   if(people.length){const e=await all(env,'SELECT person,date,end_date,all_day FROM calendar_events WHERE all_day=1');const busy=e.filter(x=>people.includes(x.person)||x.person==='Family');const before=allCandidates.length;allCandidates=allCandidates.filter(f=>!busy.some(x=>f.date>=x.date&&f.date<=(x.end_date||x.date)));calendarBlocks=before-allCandidates.length;}
   return json({flights:allCandidates.slice(0,1000),pairs:pairWeekend(allCandidates).slice(0,1000),totalFlights:allCandidates.length,calendarBlocks,calendarLimit:'All-day events are hard blocks; timed events require manual review',trimmed:allCandidates.length>1000});}
  if(path==='/api/coverage'&&req.method==='GET'){const cov=await all(env,'SELECT * FROM coverage ORDER BY airport,direction');const totals=await all(env,'SELECT source,carrier,COUNT(*) n FROM schedule_rules GROUP BY source,carrier ORDER BY n DESC LIMIT 120');return json({coverage:cov,byCarrier:totals,warning:'Counts are observed coverage, not certified proof of all airline schedules'});}
  if(path==='/api/verify'&&req.method==='POST')return json(await verifyFlight(env,await body(req)));
  if(path==='/api/prices/search'&&req.method==='POST')return json({offers:await priceSearch(env,await body(req))});
  if(path==='/api/prices/booking'&&req.method==='POST'){const x=await body(req);if(!x.booking_token||String(x.booking_token).length>2000)throw Error('Valid booking token required');const p=await chooseProfile(env,'serpapi',x.profile_id);const u=new URL('https://serpapi.com/search.json');u.searchParams.set('engine','google_flights');u.searchParams.set('booking_token',String(x.booking_token));u.searchParams.set('api_key',p.secret);const response=await fetch(u);await incrementUsage(env,p);if(!response.ok)throw Error('SerpApi booking options HTTP '+response.status);const data=await response.json();return json({booking_options:(data.booking_options||[]).slice(0,25),note:'Confirm final price and baggage directly with seller'});}

  if(path==='/api/prices/watches'&&req.method==='GET')return json({watches:await all(env,'SELECT * FROM price_watches ORDER BY date')});
  if(path==='/api/prices/watches'&&req.method==='POST'){const x=await body(req);if(!iso(x.date)||!/^[A-Z]{3}$/.test(x.origin)||!/^[A-Z]{3}$/.test(x.destination))throw Error('Invalid watch');const key=id();await sql(env,'INSERT INTO price_watches(id,origin,destination,date,passengers,target,currency,enabled) VALUES(?,?,?,?,?,?,?,1)',key,x.origin,x.destination,x.date,Math.max(1,Number(x.passengers||1)),Number(x.target||0),'GBP').run();return json({id:key});}
  if(path==='/api/prices/watches/check'&&req.method==='POST'){const x=await body(req);const watch=await first(env,'SELECT * FROM price_watches WHERE id=? AND enabled=1',x.id);if(!watch)throw Error('Active watch not found');const offers=await priceSearch(env,watch);if(!offers.length)return json({found:false});const best=Math.min(...offers.map(o=>o.price));await sql(env,'INSERT INTO price_observations(watch_id,observed_at,amount,currency,segments_json) VALUES(?,?,?,?,?)',watch.id,now(),best,'GBP',JSON.stringify(offers[0].segments)).run();await sql(env,'UPDATE price_watches SET last_amount=?,last_checked=? WHERE id=?',best,now(),watch.id).run();return json({found:true,best,underTarget:best<=watch.target});}
  if(path==='/api/calendar'&&req.method==='GET')return json({events:await all(env,'SELECT * FROM calendar_events ORDER BY date LIMIT 2000')});
  if(path==='/api/calendar/import'&&req.method==='POST'){const x=await body(req);if(!['Anna','Sasha','Family'].includes(x.person))throw Error('Person not recognized');const events=extractICS(x.ics);for(const e of events){const key=await digest([x.person,e.date,e.title,e.end_date].join('|'));await sql(env,'INSERT OR REPLACE INTO calendar_events(id,person,date,end_date,start_time,end_time,all_day,title,kind,source,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',key,x.person,e.date,e.end_date,e.start_time,e.end_time,e.all_day?1:0,e.title,'BUSY','ICS',now()).run();}return json({imported:events.length,note:'Simple dated events. RRULE/RECURRENCE-ID require expanded ICS from calendar provider.'});}
  if(path==='/api/audit'&&req.method==='GET')return json({audit:await all(env,'SELECT * FROM audit ORDER BY id DESC LIMIT 100')});
  return json({error:'Unknown route'},404);
 }catch(e){console.error('Request error',e?.message);return json({error:String(e.message||'Unknown error')},400);}},
 async scheduled(_event,env,_ctx){try{await setup(env);const queued=await first(env,'SELECT event_id FROM delta_queue LIMIT 1');if(queued){await drainDeltaQueue(env);return;}const job=await first(env,"SELECT id FROM scan_jobs WHERE status IN ('PENDING','RUNNING','COMMITTING') LIMIT 1");if(job)await scanTick(env,null,false);else {const oj=await first(env,"SELECT id FROM oag_jobs WHERE status IN ('PENDING','RUNNING','COMMITTING') LIMIT 1");if(oj){try{await oagTick(env,null)}catch(e){console.error('OAG scheduled:',e.message)}}const watch=await first(env,"SELECT * FROM price_watches WHERE enabled=1 AND (last_checked IS NULL OR last_checked < ?) AND date>=? ORDER BY last_checked LIMIT 1",new Date(Date.now()-24*3600*1000).toISOString(),now().slice(0,10));if(watch){try{const offers=await priceSearch(env,watch);const best=offers.length?Math.min(...offers.map(x=>x.price)):null;if(best!==null){await sql(env,'INSERT INTO price_observations(watch_id,observed_at,amount,currency,segments_json) VALUES(?,?,?,?,?)',watch.id,now(),best,'GBP',JSON.stringify(offers[0].segments)).run();if(best<=watch.target)await audit(env,'PRICE_TARGET_REACHED',watch.origin+'-'+watch.destination+' '+watch.date+' £'+best);}await sql(env,'UPDATE price_watches SET last_amount=?,last_checked=? WHERE id=?',best,now(),watch.id).run();}catch(e){console.error('Price watch error',e.message);}}const date=await first(env,"SELECT value FROM state WHERE key='last_route_refresh'");if(!date||Date.now()-Date.parse(date.value)>30*864e5){await sql(env,"UPDATE scan_jobs SET status='PENDING',offset=0,items_seen=0 WHERE status='DONE'").run();await sql(env,"INSERT OR REPLACE INTO state(key,value) VALUES('last_route_refresh',?)",now()).run();}}}catch(e){console.error('Scheduled tick:',e.message);}}
};
