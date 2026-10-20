import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {hashPassword} from './studio-security.js';

test('F2K server: isolated workspaces/assets, account-scoped HTML, and denied cross-origin requests', async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-security-test-'));
  const password = 'test-only-password-58';
  const passwordHash = await hashPassword(password);
  const accounts = JSON.stringify([{id: 'alice', passwordHash}, {id: 'bob', passwordHash}]);
  const children = [];
  async function launch(file, cwd, extra = {}) {
    const reserve = net.createServer();
    await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
    const port = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    const child = spawn(process.execPath, [file], {cwd, env: {...process.env, NODE_ENV: 'test', PORT: String(port), STUDIO_SESSION_SECRET: 'a'.repeat(64), STUDIO_ACCOUNTS_JSON: accounts, ...extra}, stdio: ['ignore', 'pipe', 'pipe']});
    children.push(child);
    let output = ''; child.stderr.on('data', chunk => output += chunk);
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('exit', code => reject(new Error(`Server exited ${code}: ${output}`)));
    });
    return `http://127.0.0.1:${port}`;
  }
  async function login(origin, username) {
    const response = await fetch(origin + '/api/session', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({username, code: password})});
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  try {
    const f2k = await launch(path.join(root, 'render-service/server.js'), root, {F2K_STORAGE_DIR: path.join(dir, 'storage'), F2K_PUBLIC_DIR: root});
    assert.equal((await fetch(f2k + '/api/workspace')).status, 401);
    const alice = await login(f2k, 'alice'), bob = await login(f2k, 'bob');
    const headers = {Origin: f2k, Cookie: alice, 'Content-Type': 'application/json'};
    const save = await fetch(f2k + '/api/projects', {method: 'POST', headers, body: JSON.stringify({name: 'Alice private project', data: {text: 'private'}})});
    assert.equal(save.status, 200);
    const project = await save.json();
    assert.equal((await fetch(f2k + '/api/projects/' + project.id, {headers: {Cookie: bob}})).status, 404);
    assert.equal((await (await fetch(f2k + '/api/workspace', {headers: {Cookie: bob}})).json()).projects.length, 0);
    const add = await fetch(f2k + '/api/assets', {method: 'POST', headers, body: JSON.stringify({kind: 'products', name: 'private image', dataUrl: 'data:image/png;base64,iVBORw0KGgo='})});
    assert.equal(add.status, 200);
    const asset = await add.json();
    assert.equal((await fetch(f2k + asset.url, {headers: {Cookie: bob}})).status, 404);
    const image = await fetch(f2k + asset.url, {headers: {Cookie: alice}});
    assert.equal(image.status, 200); assert.match(image.headers.get('cache-control'), /no-store/);
    assert.equal((await fetch(f2k + '/api/projects', {method: 'POST', headers: {...headers, Origin: 'https://evil.example'}, body: '{}'})).status, 403);
    assert.equal((await fetch(f2k + '/api/png', {method: 'POST', headers: {Origin: f2k, 'Content-Type': 'application/json'}, body: '{}'})).status, 401);
    assert.equal((await fetch(f2k + '/')).status, 200);
    const accountHtml = await (await fetch(f2k + '/', {headers: {Cookie: alice}})).text();
    assert.match(accountHtml, /window\.STUDIO_USER="alice"/);
    assert.match(await (await fetch(f2k + '/')).text(), /window\.STUDIO_USER="guest"/);
  } finally {
    for (const child of children) child.kill('SIGTERM');
    await fs.rm(dir, {recursive: true, force: true});
  }
});
