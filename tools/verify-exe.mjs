import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';

const delay = ms => new Promise(r => setTimeout(r, ms));
async function freePort() {
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}
async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await delay(100);
  }
  throw new Error(`Timed out: ${url}`);
}
async function command(url, method, params = {}) {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error(method + ' timed out')); }, 10000);
    socket.once('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.on('message', raw => {
      const reply = JSON.parse(raw);
      if (reply.id !== 1) return;
      clearTimeout(timer); socket.close();
      reply.error ? reject(new Error(JSON.stringify(reply.error))) : resolve(reply.result);
    });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}
const directory = await mkdtemp(join(tmpdir(), 'ChromeHelper-verification-'));
const executable = join(directory, 'ChromeHelper.exe');
await copyFile(resolve('dist/ChromeHelper.exe'), executable);
const port = await freePort();
const cdpPort = await freePort();
const base = `http://127.0.0.1:${port}`;
const chrome = spawn(join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${join(directory, 'profile')}`, `--remote-debugging-port=${cdpPort}`, 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
let helper;
let output = '';
try {
  await waitFor(`http://127.0.0.1:${cdpPort}/json/version`);
  helper = spawn(executable, [], { cwd: directory, env: { ...process.env, PORT: String(port), CHROME_CDP_PORT: String(cdpPort), PATH: process.env.SystemRoot + '\\System32' }, windowsHide: true });
  helper.stdout.on('data', chunk => { output += chunk; });
  helper.stderr.on('data', chunk => { output += chunk; });
  assert.equal((await waitFor(base + '/')).status, 'ok');
  assert.equal((await waitFor(base + '/api/chrome/status')).connected, true);
  const tabs = await waitFor(base + '/api/chrome/tabs');
  const tab = tabs.find(t => t.type === 'page');
  assert.ok(tab);
  await command(tab.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: `document.body.innerHTML='<input id="test" style="position:absolute;left:0;top:0;width:300px;height:100px">'; document.querySelector('#test').addEventListener('click',()=>document.body.dataset.clicked='yes');` });
  const endpoint = base + '/api/chrome/tabs/' + tab.id;
  for (const input of [{type:'click',x:40,y:40},{type:'key',key:'a'}]) {
    const response = await fetch(endpoint + '/input', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input) });
    assert.equal(response.status, 200);
  }
  const result = await command(tab.webSocketDebuggerUrl, 'Runtime.evaluate', {expression:`JSON.stringify({value:document.querySelector('#test').value,clicked:document.body.dataset.clicked})`, returnByValue:true});
  assert.deepEqual(JSON.parse(result.result.value), {value:'a',clicked:'yes'});
  const screenshot = await fetch(endpoint + '/screenshot');
  assert.equal(screenshot.status, 200);
  const jpeg = Buffer.from(await screenshot.arrayBuffer());
  assert.equal(jpeg.subarray(0, 2).toString('hex'), 'ffd8');
  await writeFile(resolve('dist/verification.jpg'), jpeg);
  console.log(JSON.stringify({exe:executable,health:'PASS',realChrome:'PASS',tabs:'PASS',click:'PASS',keyboard:'PASS',jpegBytes:jpeg.length,standaloneWithoutNodeOnPath:'PASS'}, null, 2));
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (helper && helper.exitCode === null) helper.kill();
  chrome.kill();
}
