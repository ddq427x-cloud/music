const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const SESSION_COOKIE = 'kuolao_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}
function error(message, status = 400) { return json({ ok: false, error: message }, status); }
function bytesToHex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function randomHex(size = 32) { const b = new Uint8Array(size); crypto.getRandomValues(b); return bytesToHex(b); }
async function sha256(value) { return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/.{1,2}/g).map(x => parseInt(x, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return bytesToHex(bits);
}
function cookieValue(request, name) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}
function clearSessionCookie() { return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
function validateUsername(v) { return /^[A-Za-z0-9_\-]{3,32}$/.test(v); }
const PLATFORMS = new Set(['kuwo','qq','kugou','netease']);
function validPlatform(v) { return PLATFORMS.has(String(v || '')); }
function validSourceTemplate(v) { return typeof v === 'string' && /^https:\/\//i.test(v) && v.includes('{id}') && v.length <= 1500; }
function validSearchTemplate(v) { return v === '' || (typeof v === 'string' && /^https:\/\//i.test(v) && v.includes('{keyword}') && v.length <= 1500); }
function sourceTemplate(template, values) {
  return Object.entries(values).reduce((out,[key,value]) => out.replaceAll(`{${key}}`, encodeURIComponent(String(value ?? ''))), template);
}
function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(x => textValue(x?.name ?? x?.title ?? x)).filter(Boolean).join(', ');
  return textValue(value.name ?? value.title ?? value.songname ?? value.albumName ?? '');
}
function normalizeGenericSongs(payload, platform) {
  const rows = Array.isArray(payload) ? payload : payload?.data?.list || payload?.data || payload?.songs || payload?.result?.songs || payload?.result || payload?.list || [];
  if (!Array.isArray(rows)) return [];
  return rows.map(row => {
    const id = row.id ?? row.songId ?? row.songid ?? row.mid ?? row.songmid ?? row.rid;
    if (id == null) return null;
    const albumObj = row.album;
    return {
      platform,
      id: String(id),
      title: textValue(row.title ?? row.name ?? row.songName ?? row.songname),
      artist: textValue(row.artist ?? row.artists ?? row.singer ?? row.singers ?? row.author),
      album: textValue(row.albumName ?? row.albumname ?? albumObj),
      artwork: String(row.artwork ?? row.picUrl ?? row.cover ?? row.image ?? row.imgurl ?? albumObj?.picUrl ?? albumObj?.cover ?? '')
    };
  }).filter(x => x && x.title);
}
async function searchKuwo(query,page) {
  const target=`http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(query)}&pn=${page-1}&rn=20&uid=2574109560&ver=kwplayer_ar_8.5.4.2&vipver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
  let text=await (await fetch(target)).text();
  if (text.startsWith('callback(')||text.startsWith('jsonp(')) text=text.slice(text.indexOf('(')+1,text.lastIndexOf(')'));
  const res=JSON.parse(text);
  const data=(res.abslist||[]).map(row=>({platform:'kuwo',id:String(row.MUSICRID||'').replace('MUSIC_',''),title:String(row.NAME||''),artist:String(row.ARTIST||''),album:String(row.ALBUM||''),artwork:row.web_albumpic_short?`https://img4.kuwo.cn/star/albumcover/1080${String(row.web_albumpic_short).slice(String(row.web_albumpic_short).indexOf('/'))}`:''}));
  return {data,isEnd:(+res.PN+1)*+res.RN>=+res.TOTAL};
}
async function searchQQ(query,page) {
  const response=await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg',{method:'POST',headers:{'content-type':'application/json','referer':'https://y.qq.com','user-agent':'Mozilla/5.0'},body:JSON.stringify({req_1:{method:'DoSearchForQQMusicDesktop',module:'music.search.SearchCgiService',param:{num_per_page:20,page_num:page,query,search_type:0}}})});
  const res=await response.json();
  const meta=res?.req_1?.data?.meta||{};
  const list=res?.req_1?.data?.body?.song?.list||[];
  return {isEnd:+meta.sum<=page*20,data:list.map(row=>({platform:'qq',id:String(row.mid||row.songmid||row.id||row.songid),title:String(row.title||row.songname||''),artist:textValue(row.singer),album:textValue(row.album?.title||row.albumname),artwork:row.album?.mid?`https://y.gtimg.cn/music/photo_new/T002R800x800M000${row.album.mid}.jpg`:''}))};
}
async function searchConfiguredSource(source,query,page) {
  if (!source?.search_url_template) return {data:[],isEnd:true,skipped:true};
  const target=sourceTemplate(source.search_url_template,{keyword:query,page,limit:20});
  const response=await fetchLimited(target,{headers:{accept:'application/json'}});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload=await readJsonLimited(response);
  const config=parseAdapterConfig(source.adapter_config);
  const data=(config.search?.listPath||config.search?.fields)
    ? normalizeMappedSongs(payload,source.platform,{listPath:config.search?.listPath,fields:config.search?.fields})
    : normalizeGenericSongs(payload,source.platform);
  const isEnd=Boolean(payload?.isEnd ?? payload?.is_end ?? payload?.end ?? data.length<20);
  return {data,isEnd};
}

const PLATFORM_ALIASES = {
  kuwo: ['kw', 'kuwo'],
  qq: ['tx', 'qq'],
  kugou: ['kg', 'kugou'],
  netease: ['wy', 'netease', '163']
};
const FIELD_CANDIDATES = {
  id: ['id','songId','songid','mid','songmid','rid','hash','audio_id','copyrightId'],
  title: ['title','name','songName','songname','song_name'],
  artist: ['artist','artists','singer','singers','author','ar'],
  album: ['album','albumName','albumname','al'],
  artwork: ['artwork','picUrl','picurl','cover','image','imgurl','pic','albumPic']
};
const URL_PATH_CANDIDATES = ['url','data.url','data.playUrl','data.play_url','result.url','result.playUrl','result.play_url','playUrl','play_url','musicUrl','music_url'];
function parseAdapterConfig(value) { try { const v=JSON.parse(value||'{}'); return v&&typeof v==='object'?v:{}; } catch { return {}; } }
function getPath(obj, path) {
  if (!path) return obj;
  return String(path).split('.').reduce((cur,key)=>cur==null?undefined:cur[key],obj);
}
function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function findSongArray(payload, maxDepth=4) {
  const preferred=['data.songs','data.list','result.songs','result.list','songs','list','data','result'];
  for(const path of preferred){ const value=getPath(payload,path); if(Array.isArray(value)&&value.some(isObject)) return {path,rows:value}; }
  const seen=new Set();
  function walk(value,path,depth){
    if(depth>maxDepth||value==null||seen.has(value)) return null;
    if(typeof value==='object') seen.add(value);
    if(Array.isArray(value)) return value.some(isObject)?{path,rows:value}:null;
    if(!isObject(value)) return null;
    for(const [key,child] of Object.entries(value)){
      const found=walk(child,path?`${path}.${key}`:key,depth+1); if(found) return found;
    }
    return null;
  }
  return walk(payload,'',0);
}
function firstField(row,candidates){ return candidates.find(k=>row?.[k]!=null); }
function detectFieldMap(row){
  const map={};
  for(const [name,candidates] of Object.entries(FIELD_CANDIDATES)){ const key=firstField(row,candidates); if(key) map[name]=key; }
  return map;
}
function mappedValue(row,key){ return key?getPath(row,key):undefined; }
function normalizeMappedSongs(payload, platform, config={}) {
  const rows=config.listPath?getPath(payload,config.listPath):findSongArray(payload)?.rows;
  if(!Array.isArray(rows)) return [];
  const fields=config.fields||detectFieldMap(rows.find(isObject)||{});
  return rows.map(row=>{
    const id=mappedValue(row,fields.id);
    if(id==null) return null;
    return {
      platform,
      id:String(id),
      title:textValue(mappedValue(row,fields.title)),
      artist:textValue(mappedValue(row,fields.artist)),
      album:textValue(mappedValue(row,fields.album)),
      artwork:String(mappedValue(row,fields.artwork)||'')
    };
  }).filter(x=>x&&x.title);
}
function assertSafeRemoteUrl(value) {
  let url; try { url=new URL(value); } catch { throw new Error('接口地址格式不正确'); }
  if(url.protocol!=='https:') throw new Error('只允许 HTTPS 接口');
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if(host==='localhost'||host.endsWith('.localhost')||host==='0.0.0.0'||host==='127.0.0.1'||host==='::1') throw new Error('不允许访问本机地址');
  const m=host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if(m){ const a=+m[1],b=+m[2]; if(a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)) throw new Error('不允许访问内网地址'); }
  return url;
}
async function fetchLimited(url, options={}, timeoutMs=8000) {
  assertSafeRemoteUrl(url);
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try { return await fetch(url,{...options,signal:controller.signal,redirect:options.redirect||'follow'}); }
  finally { clearTimeout(timer); }
}
async function readJsonLimited(response,maxBytes=1024*1024){
  const len=Number(response.headers.get('content-length')||0); if(len>maxBytes) throw new Error('接口响应过大');
  const text=await response.text(); if(text.length>maxBytes) throw new Error('接口响应过大');
  return JSON.parse(text);
}
function appendQuery(base, params){
  const u=new URL(base); for(const [k,v] of Object.entries(params)) u.searchParams.set(k,v); return u.toString();
}
function searchCandidates(base,platform){
  if(base.includes('{keyword}')) return [base];
  const aliases=PLATFORM_ALIASES[platform]||[platform]; const out=[];
  for(const source of aliases){
    out.push(appendQuery(base,{type:'search',source,keyword:'{keyword}',page:'{page}',limit:'{limit}'}));
    out.push(appendQuery(base,{server:source,type:'search',name:'{keyword}',page:'{page}'}));
    out.push(appendQuery(base,{source,types:'search',name:'{keyword}',count:'{limit}',pages:'{page}'}));
    out.push(appendQuery(base,{platform,action:'search',keyword:'{keyword}',page:'{page}',limit:'{limit}'}));
  }
  try { const u=new URL(base); const root=u.pathname.endsWith('/')?base.slice(0,-1):base; out.push(`${root}/search?platform=${platform}&keyword={keyword}&page={page}&limit={limit}`); } catch {}
  return [...new Set(out)];
}
function playCandidates(base,platform){
  if(base.includes('{id}')) return [base];
  const aliases=PLATFORM_ALIASES[platform]||[platform]; const out=[];
  for(const source of aliases){
    out.push(appendQuery(base,{type:'url',source,id:'{id}',quality:'{level}',br:'{br}',type2:'{type}'}));
    out.push(appendQuery(base,{server:source,type:'url',id:'{id}',br:'{br}'}));
    out.push(appendQuery(base,{source,types:'url',id:'{id}',br:'{br}'}));
    out.push(appendQuery(base,{platform,action:'play',id:'{id}',quality:'{level}',format:'{type}'}));
  }
  try { const root=base.endsWith('/')?base.slice(0,-1):base; out.push(`${root}/url?platform=${platform}&id={id}&quality={level}&type={type}`); } catch {}
  return [...new Set(out)];
}
function findUrlPath(payload){ for(const path of URL_PATH_CANDIDATES){ const v=getPath(payload,path); if(typeof v==='string'&&/^https:\/\//i.test(v)) return path; } return null; }
async function probeSearchTemplate(template,platform,keyword='晴天'){
  const target=sourceTemplate(template,{keyword,page:1,limit:20});
  const res=await fetchLimited(target,{headers:{accept:'application/json'}});
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload=await readJsonLimited(res); const found=findSongArray(payload); if(!found||!found.rows.length) throw new Error('没有识别到歌曲数组');
  const row=found.rows.find(isObject)||{}; const fields=detectFieldMap(row); if(!fields.id||!fields.title) throw new Error('无法识别歌曲 ID 或标题字段');
  const songs=normalizeMappedSongs(payload,platform,{listPath:found.path,fields}); if(!songs.length) throw new Error('搜索结果无法标准化');
  return {template,listPath:found.path,fields,sample:songs[0]};
}
async function probePlayTemplate(template,sample){
  const target=sourceTemplate(template,{id:sample.id,level:'standard',br:'128',type:'mp3'});
  const res=await fetchLimited(target,{headers:{accept:'application/json,audio/*;q=0.9,*/*;q=0.8',range:'bytes=0-1023'},redirect:'manual'});
  if(res.status>=300&&res.status<400){ const location=res.headers.get('location'); if(location&&/^https:\/\//i.test(location)) return {template,mode:'redirect',resultPath:''}; }
  if(!res.ok && res.status!==206) throw new Error(`HTTP ${res.status}`);
  const ct=(res.headers.get('content-type')||'').toLowerCase();
  if(ct.startsWith('audio/')||ct.includes('octet-stream')) return {template,mode:'direct',resultPath:''};
  const payload=await readJsonLimited(res); const path=findUrlPath(payload); if(!path) throw new Error('没有识别到播放链接字段');
  return {template,mode:'json',resultPath:path};
}
async function probePlatform(base,platform){
  let search=null,lastError='';
  for(const template of searchCandidates(base,platform).slice(0,14)){
    try { search=await probeSearchTemplate(template,platform); break; } catch(e){ lastError=e.message; }
  }
  if(!search) return {platform,ok:false,error:`搜索接口未识别：${lastError||'无匹配格式'}`};
  let play=null,playError='';
  for(const template of playCandidates(base,platform).slice(0,14)){
    try { play=await probePlayTemplate(template,search.sample); break; } catch(e){ playError=e.message; }
  }
  return {platform,ok:true,search,play,playError:play?null:`播放接口未识别：${playError||'无匹配格式'}`};
}

async function bodyJson(request) { try { return await request.json(); } catch { return null; } }
function ensureSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}
async function currentUser(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(tokenHash, now).first();
  return row || null;
}
async function requireUser(request, env) {
  const user = await currentUser(request, env);
  return user ? { user } : { response: error('请先登录', 401) };
}
async function createSession(userId, env) {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(tokenHash, userId, now + SESSION_MAX_AGE, now).run();
  return token;
}

async function createUserWithDefaultSource(env, { username, password, role = 'user' }) {
  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const passHash = await hashPassword(password, salt);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id,username,username_lc,password_hash,password_salt,role,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, username, username.toLowerCase(), passHash, salt, role, now),
    env.DB.prepare('INSERT INTO music_sources (user_id,name,url_template,is_selected,created_at,platform,search_url_template) VALUES (?,?,?,?,?,?,?)')
      .bind(id, '酷我默认音源', 'https://music.nxinxz.com/kw.php?id={id}&level={level}&type={type}', 1, now, 'kuwo', ''),
    env.DB.prepare('INSERT INTO music_sources (user_id,name,url_template,is_selected,created_at,platform,search_url_template) VALUES (?,?,?,?,?,?,?)')
      .bind(id, 'QQ默认音源', 'https://music.nxinxz.com/kgqq/tx.php?id={id}&level={level}&type={type}', 1, now, 'qq', '')
  ]);
  return { id, username, role };
}

function bearerToken(request) {
  const value = request.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

async function api(request, env, url) {
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !ensureSameOrigin(request)) return error('非法来源', 403);
  if (url.pathname === '/api/setup/admin' && method === 'POST') {
    const setupToken = String(env.ADMIN_SETUP_TOKEN || '');
    const suppliedToken = bearerToken(request);
    if (!setupToken || !suppliedToken || suppliedToken !== setupToken) return error('初始化密钥无效', 403);

    const username = String(env.ADMIN_USERNAME || 'admin').trim();
    const password = String(env.ADMIN_PASSWORD || '');
    if (!validateUsername(username)) return error('ADMIN_USERNAME 格式不正确', 500);
    if (password.length < 12 || password.length > 128) return error('ADMIN_PASSWORD 需为 12-128 位', 500);

    const existingAdmin = await env.DB.prepare("SELECT id,username FROM users WHERE role='admin' LIMIT 1").first();
    if (existingAdmin) return json({ ok: true, already_initialized: true, admin: existingAdmin });

    const sameName = await env.DB.prepare('SELECT id FROM users WHERE username_lc=?').bind(username.toLowerCase()).first();
    if (sameName) return error('管理员用户名已被普通账号占用，请修改 ADMIN_USERNAME', 409);

    const admin = await createUserWithDefaultSource(env, { username, password, role: 'admin' });
    return json({ ok: true, initialized: true, admin: { id: admin.id, username: admin.username, role: admin.role } }, 201);
  }

  if (url.pathname === '/api/auth/me' && method === 'GET') {
    const user = await currentUser(request, env);
    return json({ ok: true, user });
  }
  if (url.pathname === '/api/auth/register' && method === 'POST') {
    const b = await bodyJson(request); const username = String(b?.username || '').trim(); const password = String(b?.password || '');
    if (!validateUsername(username)) return error('用户名需为 3-32 位字母、数字、下划线或短横线');
    if (password.length < 8 || password.length > 128) return error('密码长度需为 8-128 位');
    const exists = await env.DB.prepare('SELECT id FROM users WHERE username_lc=?').bind(username.toLowerCase()).first();
    if (exists) return error('用户名已存在', 409);
    const newUser = await createUserWithDefaultSource(env, { username, password, role: 'user' });
    const token = await createSession(newUser.id, env);
    return json({ ok:true, user:newUser }, 201, { 'set-cookie': sessionCookie(token) });
  }
  if (url.pathname === '/api/auth/login' && method === 'POST') {
    const b = await bodyJson(request); const username = String(b?.username || '').trim(); const password = String(b?.password || '');
    const row = await env.DB.prepare('SELECT id,username,password_hash,password_salt,role FROM users WHERE username_lc=?').bind(username.toLowerCase()).first();
    if (!row || (await hashPassword(password,row.password_salt)) !== row.password_hash) return error('用户名或密码错误', 401);
    const token = await createSession(row.id, env);
    return json({ ok:true, user:{id:row.id,username:row.username,role:row.role} }, 200, { 'set-cookie': sessionCookie(token) });
  }
  if (url.pathname === '/api/auth/logout' && method === 'POST') {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
    return json({ ok:true }, 200, { 'set-cookie': clearSessionCookie() });
  }

  if (url.pathname === '/api/search' && method === 'GET') {
    const query=String(url.searchParams.get('query')||'').trim(); const page=Math.max(1,Math.min(50,Number(url.searchParams.get('page')||1)));
    if(!query) return error('请输入搜索关键词');
    const user=await currentUser(request,env);
    let sources=[];
    if(user){ const result=await env.DB.prepare('SELECT id,name,url_template,search_url_template,is_selected,platform,source_kind,adapter_config FROM music_sources WHERE user_id=? ORDER BY is_selected DESC,created_at ASC').bind(user.id).all(); sources=result.results||[]; }
    const selected={}; for(const src of sources){ if(!selected[src.platform]||src.is_selected) selected[src.platform]=src; }
    const jobs={
      kuwo: selected.kuwo?.search_url_template ? searchConfiguredSource(selected.kuwo,query,page) : searchKuwo(query,page),
      qq: selected.qq?.search_url_template ? searchConfiguredSource(selected.qq,query,page) : searchQQ(query,page),
      kugou: searchConfiguredSource(selected.kugou,query,page),
      netease: searchConfiguredSource(selected.netease,query,page)
    };
    const entries=await Promise.all(Object.entries(jobs).map(async([platform,promise])=>{try{return [platform,{ok:true,...await promise}]}catch(e){console.error('search',platform,e);return [platform,{ok:false,data:[],isEnd:true,error:e.message}]} }));
    const platforms=Object.fromEntries(entries); const data=entries.flatMap(([,value])=>value.data||[]);
    return json({ok:true,data,platforms,isEnd:entries.every(([,value])=>value.isEnd)});
  }

  const auth = await requireUser(request, env); if (auth.response) return auth.response; const user = auth.user;
  if (url.pathname === '/api/favorites' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT platform,song_id AS id,title,artist,album,artwork,created_at FROM favorites WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all();
    return json({ ok:true, favorites:results });
  }
  if (url.pathname === '/api/favorites' && method === 'POST') {
    const b=await bodyJson(request); if (!b?.id || !b?.title) return error('歌曲数据不完整');
    const now=Math.floor(Date.now()/1000);
    await env.DB.prepare(`INSERT INTO favorites (user_id,platform,song_id,title,artist,album,artwork,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,platform,song_id) DO UPDATE SET title=excluded.title,artist=excluded.artist,album=excluded.album,artwork=excluded.artwork`).bind(user.id,validPlatform(b.platform)?String(b.platform):'kuwo',String(b.id),String(b.title).slice(0,300),String(b.artist||'').slice(0,300),String(b.album||'').slice(0,300),String(b.artwork||'').slice(0,1000),now).run();
    return json({ok:true},201);
  }
  if (url.pathname === '/api/favorites' && method === 'DELETE') { await env.DB.prepare('DELETE FROM favorites WHERE user_id=?').bind(user.id).run(); return json({ok:true}); }
  const favMatch=url.pathname.match(/^\/api\/favorites\/([^/]+)\/([^/]+)$/);
  if (favMatch && method==='DELETE') { await env.DB.prepare('DELETE FROM favorites WHERE user_id=? AND platform=? AND song_id=?').bind(user.id,decodeURIComponent(favMatch[1]),decodeURIComponent(favMatch[2])).run(); return json({ok:true}); }

  // 自定义歌单
  if (url.pathname === '/api/playlists' && method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT p.id,p.name,p.description,p.created_at,p.updated_at,COUNT(ps.song_id) AS song_count
      FROM playlists p LEFT JOIN playlist_songs ps ON ps.playlist_id=p.id
      WHERE p.user_id=? GROUP BY p.id ORDER BY p.updated_at DESC,p.created_at DESC
    `).bind(user.id).all();
    return json({ ok:true, playlists:results });
  }
  if (url.pathname === '/api/playlists' && method === 'POST') {
    const b=await bodyJson(request); const name=String(b?.name||'').trim(); const description=String(b?.description||'').trim();
    if (!name || name.length>80) return error('歌单名称需为 1-80 个字符');
    if (description.length>300) return error('歌单简介最多 300 个字符');
    const count=await env.DB.prepare('SELECT COUNT(*) AS c FROM playlists WHERE user_id=?').bind(user.id).first();
    if (+count.c>=50) return error('每个用户最多创建 50 个歌单');
    const id=crypto.randomUUID(), now=Math.floor(Date.now()/1000);
    await env.DB.prepare('INSERT INTO playlists (id,user_id,name,description,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(id,user.id,name,description,now,now).run();
    return json({ok:true,playlist:{id,name,description,song_count:0,created_at:now,updated_at:now}},201);
  }
  const playlistMatch=url.pathname.match(/^\/api\/playlists\/([^/]+)$/);
  if (playlistMatch && method==='PUT') {
    const id=decodeURIComponent(playlistMatch[1]), b=await bodyJson(request); const name=String(b?.name||'').trim(); const description=String(b?.description||'').trim();
    if (!name || name.length>80) return error('歌单名称需为 1-80 个字符');
    if (description.length>300) return error('歌单简介最多 300 个字符');
    const result=await env.DB.prepare('UPDATE playlists SET name=?,description=?,updated_at=? WHERE id=? AND user_id=?').bind(name,description,Math.floor(Date.now()/1000),id,user.id).run();
    if (!result.meta.changes) return error('歌单不存在',404); return json({ok:true});
  }
  if (playlistMatch && method==='DELETE') {
    const id=decodeURIComponent(playlistMatch[1]);
    const result=await env.DB.prepare('DELETE FROM playlists WHERE id=? AND user_id=?').bind(id,user.id).run();
    if (!result.meta.changes) return error('歌单不存在',404); return json({ok:true});
  }
  const playlistSongsMatch=url.pathname.match(/^\/api\/playlists\/([^/]+)\/songs$/);
  if (playlistSongsMatch && method==='GET') {
    const id=decodeURIComponent(playlistSongsMatch[1]);
    const pl=await env.DB.prepare('SELECT id,name,description FROM playlists WHERE id=? AND user_id=?').bind(id,user.id).first();
    if (!pl) return error('歌单不存在',404);
    const {results}=await env.DB.prepare('SELECT platform,song_id AS id,title,artist,album,artwork,sort_order,created_at FROM playlist_songs WHERE playlist_id=? ORDER BY sort_order ASC,created_at ASC').bind(id).all();
    return json({ok:true,playlist:pl,songs:results});
  }
  if (playlistSongsMatch && method==='POST') {
    const id=decodeURIComponent(playlistSongsMatch[1]), b=await bodyJson(request);
    const pl=await env.DB.prepare('SELECT id FROM playlists WHERE id=? AND user_id=?').bind(id,user.id).first();
    if (!pl) return error('歌单不存在',404); if(!b?.id||!b?.title)return error('歌曲数据不完整');
    const max=await env.DB.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM playlist_songs WHERE playlist_id=?').bind(id).first(); const now=Math.floor(Date.now()/1000);
    await env.DB.prepare(`INSERT INTO playlist_songs (playlist_id,platform,song_id,title,artist,album,artwork,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(playlist_id,platform,song_id) DO UPDATE SET title=excluded.title,artist=excluded.artist,album=excluded.album,artwork=excluded.artwork`).bind(id,validPlatform(b.platform)?String(b.platform):'kuwo',String(b.id),String(b.title).slice(0,300),String(b.artist||'').slice(0,300),String(b.album||'').slice(0,300),String(b.artwork||'').slice(0,1000),+max.n,now).run();
    await env.DB.prepare('UPDATE playlists SET updated_at=? WHERE id=?').bind(now,id).run(); return json({ok:true},201);
  }
  if (playlistSongsMatch && method==='DELETE') {
    const id=decodeURIComponent(playlistSongsMatch[1]); const pl=await env.DB.prepare('SELECT id FROM playlists WHERE id=? AND user_id=?').bind(id,user.id).first(); if(!pl)return error('歌单不存在',404);
    await env.DB.prepare('DELETE FROM playlist_songs WHERE playlist_id=?').bind(id).run(); await env.DB.prepare('UPDATE playlists SET updated_at=? WHERE id=?').bind(Math.floor(Date.now()/1000),id).run(); return json({ok:true});
  }
  const playlistSongMatch=url.pathname.match(/^\/api\/playlists\/([^/]+)\/songs\/([^/]+)\/([^/]+)$/);
  if (playlistSongMatch && method==='DELETE') {
    const id=decodeURIComponent(playlistSongMatch[1]), platform=decodeURIComponent(playlistSongMatch[2]), songId=decodeURIComponent(playlistSongMatch[3]); const pl=await env.DB.prepare('SELECT id FROM playlists WHERE id=? AND user_id=?').bind(id,user.id).first(); if(!pl)return error('歌单不存在',404);
    await env.DB.prepare('DELETE FROM playlist_songs WHERE playlist_id=? AND platform=? AND song_id=?').bind(id,platform,songId).run(); await env.DB.prepare('UPDATE playlists SET updated_at=? WHERE id=?').bind(Math.floor(Date.now()/1000),id).run(); return json({ok:true});
  }

  if (url.pathname === '/api/sources/probe' && method === 'POST') {
    const b=await bodyJson(request); const base=String(b?.base_url||'').trim(); const prefix=String(b?.name_prefix||'自动识别').trim().slice(0,40)||'自动识别';
    assertSafeRemoteUrl(base);
    const count=await env.DB.prepare('SELECT COUNT(*) AS c FROM music_sources WHERE user_id=?').bind(user.id).first();
    if(+count.c>=20) return error('每个用户最多 20 个音源');
    const results=await Promise.all([...PLATFORMS].map(platform=>probePlatform(base,platform)));
    const detected=results.filter(x=>x.ok&&x.search);
    if(!detected.length) return json({ok:false,error:'没有识别到可用平台',results},422);
    const remaining=20-(+count.c); const saveList=detected.slice(0,remaining); const now=Math.floor(Date.now()/1000); const saved=[];
    for(const item of saveList){
      const existingSelected=await env.DB.prepare('SELECT id FROM music_sources WHERE user_id=? AND platform=? AND is_selected=1 LIMIT 1').bind(user.id,item.platform).first();
      const playTemplate=item.play?.template||'';
      if(!playTemplate) continue;
      const config={version:1,baseUrl:base,search:{listPath:item.search.listPath,fields:item.search.fields},play:{mode:item.play.mode,resultPath:item.play.resultPath||''}};
      const result=await env.DB.prepare('INSERT INTO music_sources (user_id,name,url_template,is_selected,created_at,platform,search_url_template,source_kind,adapter_config) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(user.id,`${prefix}-${item.platform}`,playTemplate,existingSelected?0:1,now,item.platform,item.search.template,'auto',JSON.stringify(config)).run();
      saved.push({id:result.meta.last_row_id,platform:item.platform,name:`${prefix}-${item.platform}`});
    }
    if(!saved.length) return json({ok:false,error:'识别到搜索接口，但没有识别到可用播放接口',results},422);
    return json({ok:true,saved,results},201);
  }
  if (url.pathname === '/api/resolve' && method === 'GET') {
    const sourceId=Number(url.searchParams.get('source')||0), songId=String(url.searchParams.get('id')||''), level=String(url.searchParams.get('level')||'standard'), type=String(url.searchParams.get('type')||'mp3');
    if(!sourceId||!songId) return error('播放参数不完整');
    const src=await env.DB.prepare('SELECT id,url_template,adapter_config FROM music_sources WHERE id=? AND user_id=?').bind(sourceId,user.id).first(); if(!src)return error('音源不存在',404);
    const config=parseAdapterConfig(src.adapter_config); const target=sourceTemplate(src.url_template,{id:songId,level,br:level==='lossless'?'999':level==='exhigh'?'320':'128',type}); assertSafeRemoteUrl(target);
    const mode=config.play?.mode||'direct';
    if(mode==='direct'||mode==='redirect') return Response.redirect(target,302);
    const res=await fetchLimited(target,{headers:{accept:'application/json'}}); if(!res.ok)return error(`音源接口返回 HTTP ${res.status}`,502);
    const payload=await readJsonLimited(res); const playUrl=getPath(payload,config.play?.resultPath)||getPath(payload,findUrlPath(payload));
    if(typeof playUrl!=='string'||!/^https:\/\//i.test(playUrl)) return error('音源未返回可播放链接',502); assertSafeRemoteUrl(playUrl); return Response.redirect(playUrl,302);
  }

  if (url.pathname === '/api/sources' && method === 'GET') {
    const {results}=await env.DB.prepare('SELECT id,name,url_template,search_url_template,platform,is_selected,created_at,source_kind,adapter_config FROM music_sources WHERE user_id=? ORDER BY is_selected DESC,created_at ASC').bind(user.id).all();
    return json({ok:true,sources:results});
  }
  if (url.pathname === '/api/sources' && method === 'POST') {
    const b=await bodyJson(request); const name=String(b?.name||'').trim(), template=String(b?.url_template||'').trim(), searchTemplate=String(b?.search_url_template||'').trim(), platform=String(b?.platform||''), sourceKind=String(b?.source_kind||'template'), adapterConfig=JSON.stringify(b?.adapter_config||{});
    if (!name || name.length>80) return error('音源名称不正确'); if(!validPlatform(platform)) return error('平台不正确'); if (!validSourceTemplate(template)) return error('播放接口必须是 HTTPS，并包含 {id}'); if(!validSearchTemplate(searchTemplate)) return error('搜索接口必须是 HTTPS，并包含 {keyword}');
    const now=Math.floor(Date.now()/1000); const count=await env.DB.prepare('SELECT COUNT(*) AS c FROM music_sources WHERE user_id=?').bind(user.id).first(); if (+count.c>=20) return error('每个用户最多 20 个音源');
    const result=await env.DB.prepare('INSERT INTO music_sources (user_id,name,url_template,is_selected,created_at,platform,search_url_template,source_kind,adapter_config) VALUES (?,?,?,?,?,?,?,?,?)').bind(user.id,name,template,0,now,platform,searchTemplate,sourceKind,adapterConfig).run();
    return json({ok:true,id:result.meta.last_row_id},201);
  }
  const sourceMatch=url.pathname.match(/^\/api\/sources\/(\d+)$/);
  if (sourceMatch && method==='PUT') {
    const id=Number(sourceMatch[1]), b=await bodyJson(request); const name=String(b?.name||'').trim(), template=String(b?.url_template||'').trim(), searchTemplate=String(b?.search_url_template||'').trim(), platform=String(b?.platform||''), sourceKind=String(b?.source_kind||'template'), adapterConfig=JSON.stringify(b?.adapter_config||{});
    if (!name || !validPlatform(platform) || !validSourceTemplate(template) || !validSearchTemplate(searchTemplate)) return error('音源信息不正确');
    await env.DB.prepare('UPDATE music_sources SET name=?,url_template=?,platform=?,search_url_template=?,source_kind=?,adapter_config=? WHERE id=? AND user_id=?').bind(name,template,platform,searchTemplate,sourceKind,adapterConfig,id,user.id).run(); return json({ok:true});
  }
  if (sourceMatch && method==='DELETE') {
    const id=Number(sourceMatch[1]); const selected=await env.DB.prepare('SELECT is_selected FROM music_sources WHERE id=? AND user_id=?').bind(id,user.id).first();
    if (!selected) return error('音源不存在',404); if (selected.is_selected) return error('不能删除当前选中的音源');
    await env.DB.prepare('DELETE FROM music_sources WHERE id=? AND user_id=?').bind(id,user.id).run(); return json({ok:true});
  }
  const selectMatch=url.pathname.match(/^\/api\/sources\/(\d+)\/select$/);
  if (selectMatch && method==='POST') {
    const id=Number(selectMatch[1]); const exists=await env.DB.prepare('SELECT id,platform FROM music_sources WHERE id=? AND user_id=?').bind(id,user.id).first(); if(!exists)return error('音源不存在',404);
    await env.DB.batch([env.DB.prepare('UPDATE music_sources SET is_selected=0 WHERE user_id=? AND platform=?').bind(user.id,exists.platform),env.DB.prepare('UPDATE music_sources SET is_selected=1 WHERE id=? AND user_id=?').bind(id,user.id)]); return json({ok:true});
  }
  return error('接口不存在',404);
}

export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(request,env,url);
      const response=await env.ASSETS.fetch(request);
      const headers=new Headers(response.headers);
      headers.set('x-content-type-options','nosniff'); headers.set('referrer-policy','strict-origin-when-cross-origin'); headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    } catch (e) { console.error(e); return error('服务器内部错误',500); }
  }
};
