import { build } from 'esbuild';
import { spawn } from 'node:child_process';

await build({
  entryPoints: ['src/selfcheck.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'dist/selfcheck.mjs',
  logLevel: 'warning',
});

const child = spawn(process.execPath, ['dist/selfcheck.mjs'], { stdio: 'inherit' });
const code = await new Promise((resolve) => child.on('exit', resolve));
process.exit(code ?? 1);
