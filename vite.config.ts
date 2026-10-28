import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type ViteDevServer } from 'vite';
import { listDirectory, openReadStream } from './miniapp/node/files.mjs';

const workerSource = readFileSync(new URL('./dist/volume.worker.js', import.meta.url), 'utf8');

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function handleApi(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/api/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    response.write(': open\n\n');
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/list') {
    try {
      const value = await listDirectory(url.searchParams.get('path') ?? '');
      sendJson(response, 200, { ok: true, value });
    } catch (error) {
      const cause = error as { code?: string; message?: string };
      sendJson(response, cause.code === 'not_found' ? 404 : 400, { ok: false, error: { code: cause.code, message: cause.message } });
    }
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/file') {
    try {
      const file = await openReadStream(url.searchParams.get('path') ?? '');
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': file.size,
        'cache-control': 'no-store',
      });
      file.stream.pipe(response);
    } catch (error) {
      const cause = error as { code?: string; message?: string };
      sendJson(response, cause.code === 'not_found' ? 404 : 400, { ok: false, error: { code: cause.code, message: cause.message } });
    }
    return true;
  }
  return false;
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'medview-files',
      configureServer(server: ViteDevServer) {
        server.middlewares.use((request, response, next) => {
          void handleApi(request, response).then((handled) => {
            if (!handled) next();
          }).catch((error: unknown) => {
            sendJson(response, 500, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } });
          });
        });
      },
    },
  ],
  define: {
    __MEDVIEW_WORKER_SOURCE__: JSON.stringify(workerSource),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
