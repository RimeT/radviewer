import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { listDirectory, openReadStream } from './files.mjs';
import { handleMcpHttp } from './mcp.mjs';
import { callViewerTool, readPluginResource } from './tools.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.map': 'application/json; charset=utf-8',
};

export async function start(context) {
  const clientRoot = path.join(context.pluginRoot, 'miniapp', 'client');
  const pages = new Set();
  let latest = null;
  let nextId = 1;
  let disposed = false;

  function publish(opened) {
    const event = {
      type: 'open',
      id: nextId,
      path: opened.path,
      format: opened.format,
      folder: opened.folder,
    };
    nextId += 1;
    latest = event;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const page of pages) {
      if (!page.writableEnded) page.write(payload);
    }
    return event;
  }

  async function callTool(name, args) {
    const outcome = await callViewerTool(name, args);
    if (outcome.opened) {
      publish(outcome.opened);
      context.logger?.info?.('radviewer.open', { format: outcome.opened.format });
    }
    return outcome;
  }

  const server = createServer((request, response) => {
    void route(request, response).catch((error) => {
      if (response.headersSent || response.writableEnded) {
        response.destroy();
        return;
      }
      json(response, 500, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } });
    });
  });

  async function route(request, response) {
    const url = new URL(request.url ?? '/', 'http://miniapp.local');
    if (url.pathname === '/mcp/radviewer' || url.pathname === '/mcp/radviewer/') {
      await handleMcpHttp(request, response, callTool, { readResource: readPluginResource });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(': open\n\n');
      if (latest) response.write(`data: ${JSON.stringify(latest)}\n\n`);
      pages.add(response);
      request.on('close', () => pages.delete(response));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/list') {
      try {
        const value = await listDirectory(url.searchParams.get('path') ?? '');
        json(response, 200, { ok: true, value });
      } catch (error) {
        json(response, statusOf(error), { ok: false, error: { code: error.code, message: error.message } });
      }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/file') {
      try {
        const file = await openReadStream(url.searchParams.get('path') ?? '');
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': file.size,
          'cache-control': 'no-store',
        });
        file.stream.on('error', () => response.destroy());
        request.on('close', () => file.stream.destroy());
        file.stream.pipe(response);
      } catch (error) {
        json(response, statusOf(error), { ok: false, error: { code: error.code, message: error.message } });
      }
      return;
    }
    if (request.method === 'GET') {
      const filePath = clientFile(clientRoot, url.pathname);
      if (filePath) {
        await serveFile(response, filePath);
        return;
      }
    }
    json(response, 404, { ok: false, error: { message: 'not_found' } });
  }

  await listen(server, context.listen.host, context.listen.port);
  context.logger?.info?.('miniapp.runtime.listening');

  const onAbort = () => { void dispose(); };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  async function dispose() {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    for (const page of pages) {
      try { page.end(); } catch { /* the page already left */ }
    }
    pages.clear();
    server.closeAllConnections?.();
    await close(server);
  }

  return { dispose };
}

function clientFile(root, pathname) {
  if (pathname === '/radviewer' || pathname === '/radviewer/') return path.join(root, 'index.html');
  if (!pathname.startsWith('/radviewer/')) return null;
  let rel = pathname.slice('/radviewer/'.length);
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (!rel || rel.includes('\0')) return null;
  const full = path.resolve(root, rel);
  const base = path.resolve(root);
  const relative = path.relative(base, full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return full;
}

async function serveFile(response, filePath) {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    json(response, 404, { ok: false, error: { message: 'RadViewer page is not built. Run npm run build.' } });
    return;
  }
  if (!info.isFile()) {
    json(response, 404, { ok: false, error: { message: 'not_found' } });
    return;
  }
  const type = TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  response.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(response);
}

function statusOf(error) {
  if (error && (error.code === 'not_found' || error.code === 'ENOENT')) return 404;
  return 400;
}

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
