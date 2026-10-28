const PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

export const TOOLS = [
  {
    name: 'list_studies',
    description: 'List DICOM series, NIfTI volumes, and NRRD files in an absolute directory, including one level of subfolders. Paired masks are not listed as their own study.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute directory path on this machine.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'open_study',
    description: 'Select a DICOM, NIfTI, or NRRD study. In MiniMax Code this opens the RadViewer page. path is an absolute file or directory. Do not decode the pixels.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path of a DICOM file, a DICOM series folder, a NIfTI volume, an NRRD file, or a directory that contains one of those.',
        },
      },
      required: ['path'],
    },
  },
];

function reply(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function failure(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export async function dispatchMessage(message, callTool) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return failure(message && 'id' in message ? message.id : null, -32600, 'Invalid Request');
  }
  const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : undefined;
  const notification = id === undefined;
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return null;
  if (message.method === 'initialize') {
    const requested = message.params && message.params.protocolVersion;
    const protocolVersion = PROTOCOL_VERSIONS.has(requested) ? requested : '2025-03-26';
    return reply(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'radviewer', version: '0.1.0' },
    });
  }
  if (message.method === 'ping') return reply(id, {});
  if (message.method === 'tools/list') return reply(id, { tools: TOOLS });
  if (message.method === 'tools/call') {
    const name = message.params && message.params.name;
    const args = message.params && message.params.arguments && typeof message.params.arguments === 'object'
      ? message.params.arguments
      : {};
    try {
      const text = await callTool(name, args);
      return reply(id, { content: [{ type: 'text', text: String(text) }], isError: false });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return reply(id, { content: [{ type: 'text', text }], isError: true });
    }
  }
  if (notification) return null;
  return failure(id, -32601, `Method not found: ${message.method}`);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(Object.assign(new Error('MCP body is too large.'), { code: 'too_large' }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

export async function handleMcpHttp(request, response, callTool) {
  if (request.method === 'GET') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    response.write(': open\n\n');
    const timer = setInterval(() => {
      if (!response.writableEnded) response.write(': ping\n\n');
    }, 15000);
    request.on('close', () => clearInterval(timer));
    return;
  }
  if (request.method === 'DELETE') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'GET, POST, DELETE' });
    response.end();
    return;
  }
  let raw = '';
  try {
    raw = await readBody(request);
  } catch {
    sendJson(response, 400, failure(null, -32700, 'Parse error'));
    return;
  }
  let message;
  try {
    message = JSON.parse(raw || 'null');
  } catch {
    sendJson(response, 400, failure(null, -32700, 'Parse error'));
    return;
  }
  if (Array.isArray(message)) {
    const replies = [];
    for (const item of message) {
      const result = await dispatchMessage(item, callTool);
      if (result) replies.push(result);
    }
    if (replies.length === 0) {
      response.writeHead(202);
      response.end();
      return;
    }
    sendJson(response, 200, replies);
    return;
  }
  const result = await dispatchMessage(message, callTool);
  if (!result) {
    response.writeHead(202);
    response.end();
    return;
  }
  sendJson(response, 200, result);
}
