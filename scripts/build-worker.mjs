import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await esbuild.build({
  entryPoints: ['src/volume.worker.ts'],
  outfile: 'dist/volume.worker.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
});
