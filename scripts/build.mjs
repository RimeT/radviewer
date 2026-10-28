import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const worker = spawnSync(process.execPath, ['scripts/build-worker.mjs'], { stdio: 'inherit' });
if (worker.status !== 0) process.exit(worker.status ?? 1);

const workerSource = readFileSync('dist/volume.worker.js', 'utf8');
mkdirSync('miniapp/client', { recursive: true });

await esbuild.build({
  entryPoints: ['src/app.tsx'],
  outfile: 'miniapp/client/app.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  define: {
    __MEDVIEW_WORKER_SOURCE__: JSON.stringify(workerSource),
  },
});

writeFileSync('miniapp/client/index.html', `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RadViewer</title>
    <link rel="stylesheet" href="/radviewer/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/radviewer/app.js"></script>
  </body>
</html>
`);

// Local marketplace installations copy only chatgpt/, so ship its runtime too.
for (const directory of ['node', 'client']) {
  cpSync(`miniapp/${directory}`, `chatgpt/miniapp/${directory}`, { recursive: true });
}
cpSync('skills/radviewer/SKILL.md', 'chatgpt/skills/radviewer/SKILL.md');
cpSync('LICENSE', 'chatgpt/LICENSE');
cpSync('icon.png', 'chatgpt/icon.png');
