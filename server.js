/** FOOTBALL ZONE — API-Football (API-SPORTS) proxy. Keep the API key on the server. */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = __dirname;
// Load .env without adding a dependency. Existing process environment wins.
try {
  const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}

const PORT = Number(process.env.PORT || 3000);
const BASE = 'https://v3.football.api-sports.io';
const API_KEY = process.env.APIFOOTBALL_KEY || process.env.FOOTBALL_API_KEY || '';
const CACHE_MS = Math.max(60_000, Number(process.env.SPORTS_CACHE_MS || 60_000));
const cache = new Map();

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(body));
}
function tehranDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tehran', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === s;
}
async function api(endpoint, params = {}, ttl = CACHE_MS) {
  if (!API_KEY) { const e = new Error('کلید API تنظیم نشده است. مقدار APIFOOTBALL_KEY را در فایل .env وارد کن.'); e.code='NO_API_KEY'; throw e; }
  const url = new URL(endpoint, BASE);
  for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const key = url.toString();
  const old = cache.get(key);
  if (old && Date.now() - old.at < ttl) return { data:old.data, cached:true, headers:old.headers };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try { response = await fetch(url, { headers:{ 'x-apisports-key':API_KEY, 'Accept':'application/json' }, signal:controller.signal }); }
  catch (err) { const e = new Error(err.name === 'AbortError' ? 'زمان پاسخ‌گویی سرویس تمام شد.' : 'ارتباط با سرویس فوتبال برقرار نشد.'); e.code='NETWORK_ERROR'; throw e; }
  finally { clearTimeout(timer); }
  const json = await response.json().catch(() => ({}));
  const headers = {
    dailyLimit:response.headers.get('x-ratelimit-requests-limit'),
    dailyRemaining:response.headers.get('x-ratelimit-requests-remaining'),
    minuteLimit:response.headers.get('x-ratelimit-limit'),
    minuteRemaining:response.headers.get('x-ratelimit-remaining')
  };
  if (!response.ok || (json.errors && Object.keys(json.errors).length)) {
    const msg = Object.values(json.errors || {}).filter(Boolean).join(' · ');
    const e = new Error(msg || `API-Football پاسخ ${response.status} برگرداند.`);
    e.code = response.status === 401 || response.status === 403 ? 'API_AUTH' : response.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM_ERROR';
    throw e;
  }
  cache.set(key, { at:Date.now(), data:json, headers });
  return { data:json, cached:false, headers };
}
function normalizeFixture(x) {
  const f=x.fixture||{}, teams=x.teams||{}, goals=x.goals||{}, league=x.league||{};
  const status=f.status||{};
  const timestamp=f.timestamp || (f.date ? Math.floor(new Date(f.date).getTime()/1000) : 0);
  return {
    id:String(f.id ?? ''), detailSlug:String(f.id ?? ''), date:f.date || '', timestamp,
    status:String(status.short || 'NS'), statusLong:String(status.long || ''), elapsed:status.elapsed ?? null,
    league:String(league.name || 'مسابقات فوتبال'), leagueId:league.id ?? null,
    country:String(league.country || ''), round:String(league.round || ''), venue:String(f.venue?.name || ''),
    home:String(teams.home?.name || 'میزبان'), away:String(teams.away?.name || 'میهمان'),
    homeLogo:String(teams.home?.logo || ''), awayLogo:String(teams.away?.logo || ''),
    homeGoals:goals.home ?? null, awayGoals:goals.away ?? null
  };
}
function errorBody(e) {
  let message='دریافت اطلاعات از API-Football ناموفق بود.';
  if(e.code==='NO_API_KEY') message=e.message;
  if(e.code==='API_AUTH') message='کلید API معتبر نیست یا دسترسی این سرویس برای حساب فعال نشده است. کلید را در داشبورد بررسی کن.';
  if(e.code==='RATE_LIMIT') message='سهمیه درخواست API تمام شده یا محدودیت موقت درخواست فعال است. کمی بعد دوباره تلاش کن.';
  if(e.code==='NETWORK_ERROR') message=e.message;
  return {ok:false,code:e.code||'UPSTREAM_ERROR',message};
}
async function route(req,res) {
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`), p=u.pathname;
  if(req.method!=='GET') return send(res,405,{ok:false,message:'Method not allowed'});
  if(p==='/api/health') return send(res,200,{ok:true,configured:Boolean(API_KEY),provider:'API-Football',apiKeyRequired:true,timezone:'Asia/Tehran',cacheSeconds:Math.round(CACHE_MS/1000)});
  if(p==='/api/matches' || p==='/api/live') {
    const date=u.searchParams.get('date')||tehranDate();
    if(p==='/api/matches'&&!validDate(date)) return send(res,400,{ok:false,message:'تاریخ باید با قالب YYYY-MM-DD باشد.'});
    try {
      const params=p==='/api/live'?{live:'all',timezone:'Asia/Tehran'}:{date,timezone:'Asia/Tehran'};
      const r=await api('/fixtures',params,CACHE_MS);
      const matches=(Array.isArray(r.data.response)?r.data.response:[]).map(normalizeFixture)
        .filter(m=>m.id&&m.home&&m.away)
        .sort((a,b)=>a.timestamp-b.timestamp);
      return send(res,200,{ok:true,date:p==='/api/live'?tehranDate():date,timezone:'Asia/Tehran',matches,count:matches.length,cached:r.cached,provider:'API-Football',quota:r.headers});
    } catch(e) { return send(res,e.code==='RATE_LIMIT'?429:e.code==='API_AUTH'?502: e.code==='NO_API_KEY'?503:502,errorBody(e)); }
  }
  const detail=p.match(/^\/api\/match\/(\d+)$/);
  if(detail) {
    try {
      const id=detail[1];
      // Extra data is requested only when a user opens a match, not on every refresh.
      const [fixtureR,eventsR,statsR,lineupsR] = await Promise.all([
        api('/fixtures',{id,timezone:'Asia/Tehran'},CACHE_MS),
        api('/fixtures/events',{fixture:id},CACHE_MS),
        api('/fixtures/statistics',{fixture:id},CACHE_MS),
        api('/fixtures/lineups',{fixture:id},CACHE_MS)
      ]);
      const fixture=Array.isArray(fixtureR.data.response)?fixtureR.data.response[0]:null;
      if(!fixture) return send(res,404,{ok:false,message:'اطلاعات این مسابقه پیدا نشد.'});
      return send(res,200,{
        ok:true,slug:id,match:normalizeFixture(fixture),data:fixture,
        events:Array.isArray(eventsR.data.response)?eventsR.data.response:[],
        statistics:Array.isArray(statsR.data.response)?statsR.data.response:[],
        lineups:Array.isArray(lineupsR.data.response)?lineupsR.data.response:[],
        cached:Boolean(fixtureR.cached&&eventsR.cached&&statsR.cached&&lineupsR.cached),
        provider:'API-Football'
      });
    } catch(e) { return send(res,e.code==='RATE_LIMIT'?429:e.code==='API_AUTH'?502:e.code==='NO_API_KEY'?503:502,errorBody(e)); }
  }
  if(p.startsWith('/api/')) return send(res,404,{ok:false,message:'API route not found'});
  const rel=p==='/'?'index.html':decodeURIComponent(p).replace(/^\/+/, '');
  const file=path.resolve(ROOT,rel);
  if(!file.startsWith(ROOT+path.sep)&&file!==path.join(ROOT,'index.html')) return send(res,403,{ok:false});
  fs.readFile(file,(err,data)=>{if(err)return send(res,404,{ok:false,message:'File not found'});const ext=path.extname(file).toLowerCase();if(path.basename(file)==='sw.js')res.setHeader('Service-Worker-Allowed','/');const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data);});
}
http.createServer((req,res)=>route(req,res).catch(e=>send(res,500,{ok:false,message:'خطای داخلی سرور',detail:String(e.message||e)}))).listen(PORT, '0.0.0.0', ()=>console.log(`FOOTBALL ZONE listening on port ${PORT}`));
