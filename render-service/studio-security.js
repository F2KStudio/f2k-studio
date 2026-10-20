import crypto from 'node:crypto';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';

const scrypt = promisify(crypto.scrypt);
const params = {N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024};
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Use 12–256 characters.');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, params);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [, salt, expected] = String(encoded).split('$');
  if (!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded)) return false;
  return same((await scrypt(password, salt, 64, params)).toString('hex'), expected);
}

// Deploy each app on one origin, serving its UI and API together. No browser key.
export function installSecurity(app, express, env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = env.STUDIO_ORIGIN || '';
  const secret = env.STUDIO_SESSION_SECRET || '';
  const accounts = JSON.parse(env.STUDIO_ACCOUNTS_JSON || '[]');
  if (origin && new URL(origin).origin !== origin) throw new Error('STUDIO_ORIGIN must be an origin, without a trailing slash.');
  if (production && (!origin.startsWith('https://') || secret.length < 64 || !accounts.length)) throw new Error('Configure STUDIO_ORIGIN, STUDIO_SESSION_SECRET and STUDIO_ACCOUNTS_JSON.');
  const users = new Map();
  for (const account of accounts) {
    if (!/^[a-z0-9_-]{1,64}$/.test(account.id) || account.id === 'guest' || users.has(account.id) || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(account.passwordHash)) throw new Error('Invalid or duplicate account.');
    users.set(account.id, account);
  }
  const cookieName = production ? '__Host-studio_session' : 'studio_session';
  const attempts = new Map(), usage = new Map(), sessions = new Map();
  let verifying = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const map of [attempts, usage, sessions]) for (const [key, item] of map) if (item.expires <= now) map.delete(key);
  }, 60000);
  timer.unref();
  const cookie = (value, maxAge) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production ? '; Secure' : ''}`;
  const sign = value => crypto.createHmac('sha256', secret).update(value).digest('hex');
  function readSession(req) {
    const token = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!token || token.length > 1000) return null;
    const [id, mac] = token.split('.');
    if (!id || !mac || !same(sign(id), mac)) return null;
    const session = sessions.get(id);
    if (!session || session.expires <= Date.now() || !users.has(session.userId)) return null;
    return {...session, sessionId: id};
  }
  function requireSession(req, res, next) {
    const session = readSession(req);
    if (!session) return res.status(401).json({error: 'Connexion requise.'});
    req.studioUser = session.userId;
    req.studioSession = session.sessionId;
    next();
  }
  function sameOrigin(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const expected = origin || `http://${req.get('host')}`;
    if (req.get('origin') !== expected) return res.status(403).json({error: 'Origine refusée.'});
    next();
  }
  function limit(map, key, count, windowMs) {
    let item = map.get(key);
    if (!item || item.expires <= Date.now()) {
      if (map.size >= 10000) return false;
      item = {count: 0, expires: Date.now() + windowMs}; map.set(key, item);
    }
    return ++item.count <= count;
  }
  function rateLimit(req, res, next) {
    const polling = ['GET', 'HEAD'].includes(req.method) || req.path.endsWith('/status');
    if (!limit(usage, `${req.studioUser}:${polling ? 'read' : 'write'}`, polling ? 1200 : 120, 3600000)) return res.status(429).json({error: 'Limite horaire atteinte.'});
    next();
  }
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN'});
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', sameOrigin);
  app.post('/api/session', express.json({limit: '4kb'}), async (req, res) => {
    // Do not trust browser-supplied X-Forwarded-For. Cloud Run deployment stays at one instance.
    const ip = req.socket.remoteAddress || 'unknown';
    const username = String(req.body.username || '').slice(0, 64);
    if (!limit(attempts, `ip:${ip}`, 500, 15 * 60000) || !limit(attempts, `account:${username}`, 10, 15 * 60000) || verifying >= 2 || sessions.size >= 10000) return res.status(429).json({error: 'Réessaie dans quelques minutes.'});
    const account = users.get(String(req.body.username || ''));
    // Use a valid dummy record to give unknown users the same expensive check.
    const record = account?.passwordHash || `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;
    verifying++;
    try {
      const ok = await verifyPassword(req.body.code, record);
      if (!ok || !account) return res.status(401).json({error: 'Identifiant ou mot de passe incorrect.'});
      const lifetime = req.body.remember === true ? 30 * 86400000 : 12 * 3600000;
      const id = crypto.randomBytes(32).toString('hex');
      sessions.set(id, {userId: account.id, expires: Date.now() + lifetime});
      res.setHeader('Set-Cookie', cookie(`${id}.${sign(id)}`, lifetime / 1000));
      res.json({ok: true, username: account.id});
    } catch { res.status(500).json({error: 'Connexion indisponible.'}); }
    finally { verifying--; }
  });
  app.get('/api/session', requireSession, (req, res) => res.json({ok: true, username: req.studioUser}));
  app.delete('/api/session', requireSession, (req, res) => {
    sessions.delete(req.studioSession);
    res.setHeader('Set-Cookie', cookie('', 0));
    res.json({ok: true});
  });
  // The only public API endpoint is health; all other existing and future APIs are gated.
  app.use('/api', (req, res, next) => req.path === '/health' ? next() : requireSession(req, res, () => rateLimit(req, res, next)));
  async function sendEditor(req, res, file) {
    try {
      const username = readSession(req)?.userId || 'guest';
      const html = await fs.readFile(file, 'utf8');
      res.set('Cache-Control', 'private, no-store');
      res.type('html').send(html.replace('<head>', `<head><script>window.STUDIO_USER=${JSON.stringify(username)};</script>`));
    } catch { res.status(503).send('Studio indisponible.'); }
  }
  return {requireSession, sendEditor, close: () => clearInterval(timer)};
}

export function installMakeRelay(app, express, routes, env = process.env) {
  const jobOwners = new Map(), backgroundUsage = new Map();
  const cleanup = setInterval(() => {
    for (const map of [jobOwners, backgroundUsage]) for (const [id, entry] of map) if (entry.expires <= Date.now()) map.delete(id);
  }, 60000);
  cleanup.unref();
  for (const [route, variable] of Object.entries(routes)) {
    const target = env[variable];
    if (target) {
      const url = new URL(target);
      if (url.protocol !== 'https:' || !/^hook\.[a-z0-9]+\.make\.com$/.test(url.hostname) || url.username || url.password) throw new Error(`Invalid ${variable}.`);
    }
    app.post(route, express.raw({type: () => true, limit: '15mb'}), async (req, res) => {
      if (!target) return res.status(503).json({error: 'Fonction non configurée.'});
      try {
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
        if (route.startsWith('/api/make/')) {
          if (!req.is('application/json')) return res.status(415).json({error: 'JSON requis.'});
          let payload;
          try { payload = JSON.parse(body.toString('utf8')); } catch { return res.status(400).json({error: 'JSON invalide.'}); }
          const jobId = payload?.job_id;
          const family = route.replace(/\/status$/, '');
          if (route.endsWith('/status')) {
            const job = jobOwners.get(`${family}:${jobId}`);
            if (!job || job.owner !== req.studioUser || job.expires <= Date.now()) return res.status(404).json({error: 'Job introuvable.'});
          } else if (jobId !== undefined) {
            if (typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(jobId)) return res.status(400).json({error: 'Identifiant invalide.'});
            // Existing IDs cannot be reassigned, even by a second request from the same client.
            if (jobOwners.has(`${family}:${jobId}`)) return res.status(409).json({error: 'Identifiant déjà utilisé.'});
            if (jobOwners.size >= 10000) return res.status(429).json({error: 'Réessaie plus tard.'});
            jobOwners.set(`${family}:${jobId}`, {owner: req.studioUser, expires: Date.now() + 86400000});
          }
          if (route.endsWith('/background')) {
            const day = Math.floor(Date.now() / 86400000), id = `${req.studioUser}:${day}`;
            const item = backgroundUsage.get(id) || {count: 0, expires: (day + 1) * 86400000};
            if (++item.count > 5) return res.status(429).json({error: 'Limite de 5 fonds par jour atteinte.'});
            backgroundUsage.set(id, item);
          }
        }
        const response = await fetch(target, {method: 'POST', body, headers: {'Content-Type': req.get('content-type') || 'application/json'}, signal: AbortSignal.timeout(180000), redirect: 'error'});
        if (!response.ok) return res.status(502).json({error: 'Le service de traitement a échoué.'});
        res.type(response.headers.get('content-type') || 'application/octet-stream');
        // Never forward upstream cookies, Location headers or exception messages containing secrets.
        const reader = response.body?.getReader();
        let size = 0; const chunks = [];
        if (reader) while (true) {
          const {done, value} = await reader.read(); if (done) break;
          size += value.length;
          if (size > 25 * 1024 * 1024) { await reader.cancel(); throw new Error('Response too large'); }
          chunks.push(Buffer.from(value));
        }
        res.status(response.status).send(Buffer.concat(chunks));
      } catch { res.status(502).json({error: 'Le service de traitement est indisponible.'}); }
    });
  }
}

export function installUploads(app, express, env = process.env) {
  app.post('/api/uploads', express.raw({type: () => true, limit: '13mb'}), async (req, res) => {
    const cloud = env.CLOUDINARY_CLOUD_NAME, key = env.CLOUDINARY_API_KEY, secret = env.CLOUDINARY_API_SECRET;
    if (!/^[a-z0-9_-]+$/i.test(cloud || '') || !key || !secret) return res.status(503).json({error: 'Import non configuré.'});
    try {
      const form = await new Response(req.body, {headers: {'Content-Type': req.get('content-type') || ''}}).formData();
      const file = form.get('file');
      if (!file || typeof file === 'string' || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 12 * 1024 * 1024 || !file.size) return res.status(400).json({error: 'Image invalide (12 Mo maximum).'});
      const folder = `studio/${req.studioUser}`, timestamp = String(Math.floor(Date.now() / 1000));
      const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${secret}`).digest('hex');
      const body = new FormData();
      body.set('file', file, 'image'); body.set('folder', folder); body.set('timestamp', timestamp); body.set('api_key', key); body.set('signature', signature);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {method: 'POST', body, signal: AbortSignal.timeout(60000), redirect: 'error'});
      const result = await response.json();
      if (!response.ok || !result.secure_url) throw new Error('Upload failed');
      res.json({secure_url: result.secure_url, url: result.secure_url});
    } catch { res.status(502).json({error: 'L’import de l’image a échoué.'}); }
  });
}
