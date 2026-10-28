import readline from 'node:readline';
import { dispatchMessage } from './mcp.mjs';
import { listStudies, resolveOpen } from './open.mjs';

async function callTool(name, args) {
  const raw = args && typeof args.path === 'string' ? args.path : '';
  if (name === 'list_studies') return (await listStudies(raw)).message;
  if (name === 'open_study') return (await resolveOpen(raw)).message;
  throw new Error(`Unknown tool ${name}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of lines) {
  const text = line.trim();
  if (!text) continue;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    continue;
  }
  const result = await dispatchMessage(message, callTool);
  if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
}
