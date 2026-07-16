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
function validSourceTemplate(v) { return typeof v === 'string' && /^https:\/\//i.test(v) && v.includes('{id}') && v.length <= 1000; }
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
    env.DB.prepare('INSERT INTO music_sources (user_id,name,url_template,is_selected,created_at) VALUES (?,?,?,?,?)')
      .bind(id, '默认音源', 'https://music.nxinxz.com/kw.php?id={id}&level={level}&type={type}', 1, now)
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

  const auth = await requireUser(request, env); if (auth.response) return auth.response; const user = auth.user;
  if (url.pathname === '/api/favorites' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT song_id AS id,title,artist,album,artwork,created_at FROM favorites WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all();
    return json({ ok:true, favorites:results });
  }
  if (url.pathname === '/api/favorites' && method === 'POST') {
    const b=await bodyJson(request); if (!b?.id || !b?.title) return error('歌曲数据不完整');
    const now=Math.floor(Date.now()/1000);
    await env.DB.prepare(`INSERT INTO favorites (user_id,song_id,title,artist,album,artwork,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,song_id) DO UPDATE SET title=excluded.title,artist=excluded.artist,album=excluded.album,artwork=excluded.artwork`).bind(user.id,String(b.id),String(b.title).slice(0,300),String(b.artist||'').slice(0,300),String(b.album||'').slice(0,300),String(b.artwork||'').slice(0,1000),now).run();
    return json({ok:true},201);
  }
  if (url.pathname === '/api/favorites' && method === 'DELETE') { await env.DB.prepare('DELETE FROM favorites WHERE user_id=?').bind(user.id).run(); return json({ok:true}); }
  const favMatch=url.pathname.match(/^\/api\/favorites\/([^/]+)$/);
  if (favMatch && method==='DELETE') { await env.DB.prepare('DELETE FROM favorites WHERE user_id=? AND song_id=?').bind(user.id,decodeURIComponent(favMatch[1])).run(); return json({ok:true}); }

  if (url.pathname === '/api/sources' && method === 'GET') {
    const {results}=await env.DB.prepare('SELECT id,name,url_template,is_selected,created_at FROM music_sources WHERE user_id=? ORDER BY is_selected DESC,created_at ASC').bind(user.id).all();
    return json({ok:true,sources:results});
  }
  if (url.pathname === '/api/sources' && method === 'POST') {
    const b=await bodyJson(request); const name=String(b?.name||'').trim(), template=String(b?.url_template||'').trim();
    if (!name || name.length>80) return error('音源名称不正确'); if (!validSourceTemplate(template)) return error('音源必须是 HTTPS，并包含 {id} 占位符');
    const now=Math.floor(Date.now()/1000); const count=await env.DB.prepare('SELECT COUNT(*) AS c FROM music_sources WHERE user_id=?').bind(user.id).first(); if (+count.c>=20) return error('每个用户最多 20 个音源');
    const result=await env.DB.prepare('INSERT INTO music_sources (user_id,name,url_template,is_selected,created_at) VALUES (?,?,?,?,?)').bind(user.id,name,template,0,now).run();
    return json({ok:true,id:result.meta.last_row_id},201);
  }
  const sourceMatch=url.pathname.match(/^\/api\/sources\/(\d+)$/);
  if (sourceMatch && method==='PUT') {
    const id=Number(sourceMatch[1]), b=await bodyJson(request); const name=String(b?.name||'').trim(), template=String(b?.url_template||'').trim();
    if (!name || !validSourceTemplate(template)) return error('音源信息不正确');
    await env.DB.prepare('UPDATE music_sources SET name=?,url_template=? WHERE id=? AND user_id=?').bind(name,template,id,user.id).run(); return json({ok:true});
  }
  if (sourceMatch && method==='DELETE') {
    const id=Number(sourceMatch[1]); const selected=await env.DB.prepare('SELECT is_selected FROM music_sources WHERE id=? AND user_id=?').bind(id,user.id).first();
    if (!selected) return error('音源不存在',404); if (selected.is_selected) return error('不能删除当前选中的音源');
    await env.DB.prepare('DELETE FROM music_sources WHERE id=? AND user_id=?').bind(id,user.id).run(); return json({ok:true});
  }
  const selectMatch=url.pathname.match(/^\/api\/sources\/(\d+)\/select$/);
  if (selectMatch && method==='POST') {
    const id=Number(selectMatch[1]); const exists=await env.DB.prepare('SELECT id FROM music_sources WHERE id=? AND user_id=?').bind(id,user.id).first(); if(!exists)return error('音源不存在',404);
    await env.DB.batch([env.DB.prepare('UPDATE music_sources SET is_selected=0 WHERE user_id=?').bind(user.id),env.DB.prepare('UPDATE music_sources SET is_selected=1 WHERE id=? AND user_id=?').bind(id,user.id)]); return json({ok:true});
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
