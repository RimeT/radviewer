import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pairSiblingMasks, studiesFromListing } from '../miniapp/node/catalog.mjs';
import { assertAbsolute, listDirectory } from '../miniapp/node/files.mjs';
import { dispatchMessage } from '../miniapp/node/mcp.mjs';
import { listStudies, resolveOpen } from '../miniapp/node/open.mjs';
import { start } from '../miniapp/node/server.mjs';
import { callViewerTool, readPluginResource } from '../miniapp/node/tools.mjs';

test('pairs image and mask and skips the label as its own study', () => {
  const studies = studiesFromListing('D:/case', [
    { name: 'image.nii.gz', type: 'file' },
    { name: 'mask.nii.gz', type: 'file' },
    { name: 'notes.txt', type: 'file' },
  ]);
  assert.equal(studies.length, 1);
  assert.equal(studies[0].kind, 'nifti');
  assert.equal(studies[0].maskPath, 'D:/case/mask.nii.gz');
});

test('pairs data and mask volumes in sibling folders', () => {
  const paired = pairSiblingMasks([
    { id: 'D:/case/data/045.nii.gz', title: '045', kind: 'nifti', imagePaths: ['D:/case/data/045.nii.gz'] },
    { id: 'D:/case/mask/045.nii.gz', title: '045', kind: 'nifti', imagePaths: ['D:/case/mask/045.nii.gz'] },
    {
      id: 'D:/case/view/045_image.nii.gz',
      title: '045_image',
      kind: 'nifti',
      imagePaths: ['D:/case/view/045_image.nii.gz'],
      maskPath: 'D:/case/view/045_image-label.nii.gz',
    },
  ]);
  assert.equal(paired.length, 2);
  assert.equal(paired[0].maskPath, 'D:/case/mask/045.nii.gz');
  assert.equal(paired[1].title, '045_image');
});

test('rejects a relative path', () => {
  assert.throws(() => assertAbsolute('case/image.nii.gz'), /绝对路径/);
});

test('lists studies and opens the first one in a directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'radviewer-'));
  try {
    await writeFile(path.join(dir, 'image.nii.gz'), Buffer.from([1, 2, 3]));
    await writeFile(path.join(dir, 'mask.nii.gz'), Buffer.from([4]));
    const listed = await listDirectory(dir);
    assert.equal(listed.entries.length, 2);
    const studies = await listStudies(dir);
    assert.equal(studies.studies.length, 1);
    const opened = await resolveOpen(path.join(dir, 'image.nii.gz'));
    assert.equal(opened.format, 'nifti');
    assert.match(opened.path.replace(/\\/g, '/'), /image\.nii\.gz$/);
    const folder = await resolveOpen(dir);
    assert.equal(folder.studyCount, 1);
    assert.match(folder.message, /打开/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mcp initialize, tools, and notifications', async () => {
  const init = await dispatchMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26' },
  }, async () => '');
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.name, 'radviewer');
  const tools = await dispatchMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, async () => '');
  assert.deepEqual(tools.result.tools.map((tool) => tool.name), ['list_studies', 'open_study', 'list_directory', 'read_file', 'viewer_state']);
  assert.equal(tools.result.tools[1]._meta.ui.resourceUri, 'ui://radviewer/viewer.html');
  assert.equal(tools.result.tools[1]._meta.ui.surface, 'radviewer');
  assert.equal(init.result.capabilities.resources.listChanged, false);
  assert.equal(init.result.serverInfo.version, '0.1.1');
  const note = await dispatchMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, async () => '');
  assert.equal(note, null);
  const called = await dispatchMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'open_study', arguments: { path: 'relative' } },
  }, async () => {
    throw new Error('RadViewer 需要本机绝对路径');
  });
  assert.equal(called.result.isError, true);
  assert.match(called.result.content[0].text, /绝对路径/);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

test('open_study reaches a listening page', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'radviewer-open-'));
  const port = await freePort();
  const life = await start({
    pluginId: 'radviewer',
    pluginRoot: path.resolve('tests/..'),
    dataDir: tmpdir(),
    listen: { host: '127.0.0.1', port },
    signal: new AbortController().signal,
    logger: { info() {} },
  });
  try {
    await writeFile(path.join(dir, 'image.nii.gz'), Buffer.from([1]));
    const events = await fetch(`http://127.0.0.1:${port}/api/events`);
    assert.equal(events.status, 200);
    const reader = events.body.getReader();
    const decoder = new TextDecoder();
    let received = '';
    const mcp = await fetch(`http://127.0.0.1:${port}/mcp/radviewer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'open_study', arguments: { path: dir } },
      }),
    });
    const body = await mcp.json();
    assert.equal(body.result.isError, false);
    assert.match(body.result.content[0].text, /image\.nii\.gz/);
    while (!received.includes('"type":"open"')) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      received += decoder.decode(chunk.value, { stream: true });
    }
    assert.match(received, /image\.nii\.gz/);
    await reader.cancel();
  } finally {
    await rm(dir, { recursive: true, force: true });
    await life.dispose();
  }
});

test('stdio initialize and open_study', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'radviewer-stdio-'));
  const child = spawn(process.execPath, ['miniapp/node/stdio.mjs'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = '';
  const lines = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    let split = pending.indexOf('\n');
    while (split >= 0) {
      const line = pending.slice(0, split).trim();
      pending = pending.slice(split + 1);
      if (line) lines.push(JSON.parse(line));
      split = pending.indexOf('\n');
    }
  });
  const waitFor = (count) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stdio timeout')), 4000);
    const check = setInterval(() => {
      if (lines.length < count) return;
      clearInterval(check);
      clearTimeout(timer);
      resolve();
    }, 15);
  });
  try {
    await writeFile(path.join(dir, 'image.nii.gz'), Buffer.from([1]));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
    await waitFor(1);
    assert.equal(lines[0].result.serverInfo.name, 'radviewer');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'open_study', arguments: { path: dir } } })}\n`);
    await waitFor(2);
    assert.equal(lines[1].result.isError, false);
    assert.match(lines[1].result.content[0].text, /image\.nii\.gz/);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test('viewer resource and file chunks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'radviewer-chunk-'));
  const payload = Buffer.from('nifti-bytes');
  try {
    await writeFile(path.join(dir, 'image.nii.gz'), payload);
    const listed = await dispatchMessage({ jsonrpc: '2.0', id: 1, method: 'resources/list' }, async () => '');
    assert.equal(listed.result.resources[0].uri, 'ui://radviewer/viewer.html');
    assert.equal(listed.result.resources[0].mimeType, 'text/html;profile=mcp-app');
    const page = await dispatchMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/read',
      params: { uri: 'ui://radviewer/viewer.html' },
    }, async () => '', { readResource: readPluginResource });
    assert.equal(page.result.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.match(page.result.contents[0].text, /__radviewerInlineWorker/);
    assert.match(page.result.contents[0].text, /type="module"/);
    const opened = await dispatchMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: path.join(dir, 'image.nii.gz') } },
    }, callViewerTool, { readResource: readPluginResource });
    assert.equal(opened.result.isError, false);
    const meta = opened.result.structuredContent;
    assert.equal(meta.size, payload.length);
    assert.equal(meta.chunks, 1);
    const chunk = await dispatchMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/read',
      params: { uri: `ui://radviewer/file/${meta.id}/0` },
    }, async () => '', { readResource: readPluginResource });
    assert.equal(Buffer.from(chunk.result.contents[0].blob, 'base64').equals(payload), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('page and mcp endpoint answer on the assigned port', async () => {
  const port = await freePort();
  const life = await start({
    pluginId: 'radviewer',
    pluginRoot: path.resolve('tests/..'),
    dataDir: tmpdir(),
    listen: { host: '127.0.0.1', port },
    signal: new AbortController().signal,
    logger: { info() {} },
  });
  try {
    const page = await fetch(`http://127.0.0.1:${port}/radviewer`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /\/radviewer\/app\.js/);
    const mcp = await fetch(`http://127.0.0.1:${port}/mcp/radviewer`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      }),
    });
    assert.equal(mcp.status, 200);
    const body = await mcp.json();
    assert.equal(body.result.serverInfo.name, 'radviewer');
    assert.equal(body.result.capabilities.tools.listChanged, false);
  } finally {
    await life.dispose();
  }
});
