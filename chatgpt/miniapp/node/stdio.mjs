import readline from 'node:readline';
import { dispatchMessage } from './mcp.mjs';
import { callViewerTool, readPluginResource } from './tools.mjs';

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
  const result = await dispatchMessage(message, callViewerTool, { readResource: readPluginResource });
  if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
}
