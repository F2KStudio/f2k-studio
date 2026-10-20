import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {hashPassword, verifyPassword, installSecurity, installMakeRelay, installUploads} from './studio-security.js';

test('salted passwords; gated API; forged and revoked sessions; CSRF; protected relays/uploads', async () => {
  const password = 'test-only-password-58';
  const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong', first), false);
  const app = express();
  const security = installSecurity(app, express, {STUDIO_SESSION_SECRET: 'a'.repeat(64), STUDIO_ACCOUNTS_JSON: JSON.stringify([{id: 'alice', passwordHash: first}, {id: 'bob', passwordHash: second}])});
  installMakeRelay(app, express, {'/api/cutout': 'CUTOUT_WEBHOOK_URL'}, {});
  installMakeRelay(app, express, {'/api/make/goods': 'GOODS', '/api/make/goods/status': 'STATUS', '/api/make/background': 'BACKGROUND'}, {GOODS: 'https://hook.eu1.make.com/test-create', STATUS: 'https://hook.eu1.make.com/test-status', BACKGROUND: 'https://hook.eu1.make.com/test-background'});
  installUploads(app, express, {});
  app.get('/api/private', (req, res) => res.json({user: req.studioUser}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (path, options = {}) => fetch(origin + path, options);
  const login = (username, code, extra = {}) => call('/api/session', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin, ...extra}, body: JSON.stringify({username, code})});
  const nativeFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = (url, options) => {
    if (String(url).startsWith('https://hook.eu1.make.com/')) {upstreamCalls++;return Promise.resolve(new Response('{"status":"completed"}', {headers: {'Content-Type': 'application/json'}}));}
    return nativeFetch(url, options);
  };
  try {
    assert.equal((await call('/api/private')).status, 401);
    assert.equal((await call('/api/uploads', {method: 'POST', headers: {Origin: origin}})).status, 401);
    assert.equal((await call('/api/cutout', {method: 'POST', headers: {Origin: origin}})).status, 401);
    assert.equal((await login('alice', password, {Origin: 'https://evil.example'})).status, 403);
    assert.equal((await login('alice', 'wrong')).status, 401);
    const response = await login('alice', password);
    assert.equal(response.status, 200);
    const cookieHeader = response.headers.get('set-cookie');
    assert.match(cookieHeader, /HttpOnly/); assert.match(cookieHeader, /SameSite=Strict/);
    const cookie = cookieHeader.split(';')[0];
    assert.deepEqual(await (await call('/api/private', {headers: {Cookie: cookie}})).json(), {user: 'alice'});
    assert.equal((await call('/api/private', {headers: {Cookie: cookie + 'bad'}})).status, 401);
    assert.equal((await call('/api/session', {method: 'DELETE', headers: {Cookie: cookie, Origin: 'https://evil.example'}})).status, 403);
    assert.equal((await call('/api/cutout', {method: 'POST', headers: {Cookie: cookie, Origin: origin}})).status, 503);
    assert.equal((await call('/api/session', {method: 'DELETE', headers: {Cookie: cookie, Origin: origin}})).status, 200);
    assert.equal((await call('/api/private', {headers: {Cookie: cookie}})).status, 401);
    const bob = await login('bob', password), bobCookie = bob.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await call('/api/private', {headers: {Cookie: bobCookie}})).json()).user, 'bob');
    const aliceAgain = await login('alice', password), aliceCookie = aliceAgain.headers.get('set-cookie').split(';')[0];
    const post = (path, cookie, body) => call(path, {method: 'POST', headers: {Cookie: cookie, Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    assert.equal((await post('/api/make/goods', aliceCookie, {job_id: 'alice-job'})).status, 200);
    const callsBefore = upstreamCalls;
    assert.equal((await post('/api/make/goods/status', bobCookie, {job_id: 'alice-job'})).status, 404);
    assert.equal((await post('/api/make/goods', bobCookie, {job_id: 'alice-job'})).status, 409);
    assert.equal(upstreamCalls, callsBefore);
    assert.equal((await post('/api/make/goods/status', aliceCookie, {job_id: 'alice-job'})).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await post('/api/make/background', aliceCookie, {})).status, 200);
    assert.equal((await post('/api/make/background', aliceCookie, {})).status, 429);
    const clock = Date.now;
    try {Date.now = () => clock() + 13 * 3600000; assert.equal((await call('/api/private', {headers: {Cookie: aliceCookie}})).status, 401);}
    finally {Date.now = clock;}
  } finally {globalThis.fetch = nativeFetch;security.close(); await new Promise(resolve => server.close(resolve));}
});

test('production refuses missing configuration and relay refuses arbitrary URLs', () => {
  assert.throws(() => installSecurity(express(), express, {NODE_ENV: 'production'}), /Configure/);
  assert.throws(() => installMakeRelay(express(), express, {'/api/cutout': 'TARGET'}, {TARGET: 'http://169.254.169.254/latest/meta-data'}), /Invalid/);
  assert.throws(() => installMakeRelay(express(), express, {'/api/cutout': 'TARGET'}, {TARGET: 'https://evil.example'}), /Invalid/);
});
