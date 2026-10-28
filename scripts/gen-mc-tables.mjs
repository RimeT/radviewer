import { readFileSync, writeFileSync } from 'node:fs';

const text = readFileSync(process.argv[2], 'utf8');
const edgeStart = text.indexOf('int edgeTable[256]={');
const edgeEnd = text.indexOf('};', edgeStart);
const edge = [...text.slice(edgeStart, edgeEnd).matchAll(/0x[0-9a-fA-F]+/g)].map((match) => Number.parseInt(match[0], 16));
if (edge.length !== 256) throw new Error(`edge ${edge.length}`);
const triStart = text.indexOf('int triTable[256][16] =');
const triEnd = text.indexOf('/*', triStart);
const rows = text.slice(triStart, triEnd).split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith('{'))
  .map((line) => [...line.matchAll(/-?\d+/g)].map((match) => Number.parseInt(match[0], 10)));
if (rows.length !== 256) throw new Error(`tri rows ${rows.length}`);
for (const [index, row] of rows.entries()) {
  if (row.length !== 16 || row.some((value) => Number.isNaN(value))) throw new Error(`bad row ${index}`);
}
const out = `/* Marching-cubes tables (Paul Bourke / Cory Gene Bloyd). */
export const EDGE_TABLE = new Uint16Array([${edge.join(',')}]);
export const TRI_TABLE: readonly (readonly number[])[] = [
${rows.map((row) => `[${row.join(',')}]`).join(',\n')}
];
`;
writeFileSync(new URL('../src/mcTables.ts', import.meta.url), out);
console.log('wrote mcTables', edge[1], rows[1].slice(0, 3).join(','));
