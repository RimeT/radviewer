import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { callViewerTool, FILE_CHUNK_BYTES } from '../miniapp/node/tools.mjs';

function rpcClient(child) {
  let nextId = 1;
  let buffer = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const response = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const waiter = pending.get(response.id);
      if (!waiter) continue;
      pending.delete(response.id);
      clearTimeout(waiter.timer);
      if (response.error) waiter.reject(new Error(response.error.message));
      else waiter.resolve(response.result);
    }
  });
  return (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP timeout: ' + method)); }, 5000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

test('ChatGPT package works after copying only its marketplace folder', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'radviewer-installed-'));
  let child;
  try {
    const installed = path.join(dir, 'plugin');
    await cp(new URL('../chatgpt/', import.meta.url), installed, { recursive: true });
    const config = JSON.parse(await readFile(path.join(installed, 'mcp.json'), 'utf8')).mcpServers.radviewer;
    const args = config.args.map((arg) => arg.replaceAll('${PLUGIN_ROOT}', installed));
    child = spawn(process.execPath, args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    let errors = '';
    child.stderr.on('data', (chunk) => { errors += chunk; });
    const rpc = rpcClient(child);
    const hello = await rpc('initialize', { protocolVersion: '2025-06-18' });
    assert.equal(hello.serverInfo.name, 'radviewer');
    const tools = (await rpc('tools/list')).tools;
    assert.deepEqual(tools.find((tool) => tool.name === 'show_viewer')._meta['openai/ui'].entrypoints, [{ type: 'thread' }]);
    assert.deepEqual(tools.find((tool) => tool.name === 'read_file_chunk')._meta.ui.visibility, ['app']);
    assert.equal((await rpc('tools/call', { name: 'show_viewer', arguments: {} })).isError, false);
    const bytes = Buffer.alloc(FILE_CHUNK_BYTES + 17, 73);
    const file = path.join(dir, 'image.nii.gz');
    await writeFile(file, bytes);
    const selected = await rpc('tools/call', { name: 'open_study', arguments: { path: file } });
    assert.equal(selected.isError, false);
    assert.equal(selected.structuredContent.path, file.replaceAll('\\', '/'));
    const opened = await rpc('tools/call', { name: 'read_file', arguments: { path: file } });
    const id = opened.structuredContent.id;
    assert.equal(opened.structuredContent.chunks, 2);
    const parts = [];
    for (let index = 0; index < 2; index += 1) {
      const chunk = await rpc('tools/call', { name: 'read_file_chunk', arguments: { id, index } });
      assert.equal(chunk.isError, false);
      assert.equal(chunk.structuredContent, undefined);
      parts.push(Buffer.from(chunk._meta.blob, 'base64'));
    }
    assert.deepEqual(Buffer.concat(parts), bytes);
    for (const index of [-1, 0.5, 2]) {
      assert.equal((await rpc('tools/call', { name: 'read_file_chunk', arguments: { id, index } })).isError, true);
    }
    const page = (await rpc('resources/read', { uri: 'ui://radviewer/viewer.html' })).contents[0];
    assert.equal(page.mimeType, 'text/html;profile=mcp-app');
    assert.match(page.text, /<div id="root">/);
    assert.match(page.text, /<style>/);
    assert.match(page.text, /type="module"/);
    assert.deepEqual(page._meta['openai/ui'].availableDisplayModes, ['inline', 'fullscreen']);
    assert.equal(errors, '');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('viewer bridge initializes and reads files through app tools without resource forwarding', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'radviewer-bridge-'));
  let initialize;
  let initialized = false;
  let receive;
  const listeners = new Map();
  const calls = [];
  const host = {
    postMessage(message) {
      if (message.method === 'ui/notifications/initialized') { initialized = true; return; }
      if (message.id == null) return;
      calls.push(message.method);
      Promise.resolve().then(async () => {
        let result;
        if (message.method === 'ui/initialize') {
          initialize = message.params;
          result = { protocolVersion: '2026-01-26', hostCapabilities: { serverTools: {} } };
        } else {
          assert.equal(message.method, 'tools/call');
          const outcome = await callViewerTool(message.params.name, message.params.arguments);
          result = { content: [{ type: 'text', text: outcome.text }], structuredContent: outcome.structured, _meta: outcome.meta };
        }
        receive({ source: host, data: { jsonrpc: '2.0', id: message.id, result } });
      }).catch((error) => {
        receive({ source: host, data: { jsonrpc: '2.0', id: message.id, error: { message: error.message } } });
      });
    },
  };
  const window = {
    parent: host,
    fetch() { throw new Error('Unexpected network request'); },
    addEventListener(type, callback) { listeners.set(type, callback); receive = listeners.get('message'); },
  };
  const context = vm.createContext({ window, URL, Response, DOMException, setTimeout, clearTimeout, atob }, { codeGeneration: { strings: false, wasm: false } });
  try {
    vm.runInContext(await readFile(new URL('../miniapp/node/viewer-bridge.js', import.meta.url), 'utf8'), context);
    const file = path.join(dir, 'image.nii.gz');
    const bytes = Buffer.alloc(FILE_CHUNK_BYTES + 5, 19);
    await writeFile(file, bytes);
    const listing = await (await window.fetch('/api/list?path=' + encodeURIComponent(dir))).json();
    assert.equal(listing.ok, true);
    const response = await window.fetch('/api/file?path=' + encodeURIComponent(file));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(initialize.protocolVersion, '2026-01-26');
    assert.equal(initialized, true);
    assert.equal(calls.includes('resources/read'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('inline volume worker decodes NRRD when string compilation is forbidden', async () => {
  const built = await build({ entryPoints: ['src/createWorker.ts'], bundle: true, write: false, format: 'iife', globalName: 'RadWorker', define: { __MEDVIEW_WORKER_SOURCE__: '"built"' } });
  const context = vm.createContext({ __radviewerInlineWorker: true, queueMicrotask, TextDecoder, TextEncoder }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(built.outputFiles[0].text, context);
  const worker = context.RadWorker.createVolumeWorker();
  const bytes = Buffer.concat([Buffer.from('NRRD0005\ntype: uchar\ndimension: 3\nsizes: 2 2 2\nencoding: raw\n\n'), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])]);
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker timeout')), 5000);
    worker.addEventListener('message', (event) => {
      if (event.data.op === 'progress') return;
      clearTimeout(timer);
      if (event.data.op === 'error') reject(new Error(event.data.message));
      else resolve(event.data.wire);
    });
    worker.postMessage({ id: 1, op: 'nrrd', name: 'test.nrrd', image: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  });
  worker.terminate();
  assert.deepEqual(Array.from(result.dims), [2, 2, 2]);
  assert.equal(result.valueKind, 'i16');
  assert.deepEqual(Array.from(new Int16Array(result.values)), [1, 2, 3, 4, 5, 6, 7, 8]);
});
