import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '../client');

export const VIEWER_URI = 'ui://radviewer/viewer.html';
export const HTML_MIME = 'text/html;profile=mcp-app';
export const UI_META = { 'zcode/csp': { unsafeEval: true, wasmUnsafeEval: true } };

let cached = '';

function hideClosingTag(source, tag) {
  return source.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
}

function escapeText(value) {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
}

export async function viewerDocument() {
  if (cached) return cached;
  try {
    const [css, js, bridge] = await Promise.all([
      readFile(path.join(clientRoot, 'app.css'), 'utf8'),
      readFile(path.join(clientRoot, 'app.js'), 'utf8'),
      readFile(path.join(here, 'viewer-bridge.js'), 'utf8'),
    ]);
    cached = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RadViewer</title>
    <style>${hideClosingTag(css, 'style')}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>${hideClosingTag(bridge, 'script')}</script>
    <script type="module">${hideClosingTag(js, 'script')}</script>
  </body>
</html>
`;
    return cached;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<!doctype html><meta charset="utf-8" /><title>RadViewer</title><p>${escapeText(message)}</p>`;
  }
}
