import { HTML_MIME, UI_META, VIEWER_URI } from './panel.mjs';

const PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const SURFACE = {
  resourceUri: VIEWER_URI,
  surface: 'radviewer',
  visibility: ['model', 'app'],
};

export const TOOLS = [
  {
    name: 'list_studies',
    description: 'List DICOM series, NIfTI volumes, and NRRD files in an absolute directory, including one level of subfolders. Paired masks are not listed as their own study. MiniMax Code and Zcode also open the RadViewer page on that folder.',
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
    _meta: { ui: SURFACE },
  },
  {
    name: 'open_study',
    description: 'Select a DICOM, NIfTI, or NRRD study and show it in the RadViewer page. path is an absolute file or directory. Do not decode the pixels.',
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
    _meta: { ui: SURFACE },
  },
  {
    name: 'list_directory',
    description: 'Viewer page only. List one absolute directory for the RadViewer page. Do not use this instead of list_studies.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Absolute directory path on this machine.' },
      },
      required: ['path'],
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'read_file',
    description: 'Viewer page only. Open an absolute file so the RadViewer page can read it in chunks. Do not decode the pixels.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Absolute file path on this machine.' },
      },
      required: ['path'],
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'viewer_state',
    description: 'Viewer page only. Return the study path most recently selected for the RadViewer page.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'show_viewer',
    title: 'RadViewer',
    description: 'Open the RadViewer panel to browse a local DICOM, NIfTI or NRRD study. No path is required; the user can enter one in the panel.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: SURFACE, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
  },
  {
    name: 'read_file_chunk',
    description: 'Viewer page only. Read a chunk of a file previously opened by read_file.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { id: { type: 'string', pattern: '^[0-9a-f]{16}$' }, index: { type: 'integer', minimum: 0 } },
      required: ['id', 'index'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['app'] } },
  },
];

function reply(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function failure(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolResult(outcome) {
  if (typeof outcome === 'string' || outcome == null) {
    return { content: [{ type: 'text', text: String(outcome ?? '') }], isError: false };
  }
  const result = {
    content: [{ type: 'text', text: String(outcome.text ?? '') }],
    isError: false,
  };
  if (outcome.structured) result.structuredContent = outcome.structured;
  if (outcome.meta) result._meta = outcome.meta;
  return result;
}

export async function dispatchMessage(message, callTool, options = {}) {
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
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
      },
      serverInfo: { name: 'radviewer', version: '0.1.2' },
    });
  }
  if (message.method === 'ping') return reply(id, {});
  if (message.method === 'tools/list') return reply(id, { tools: TOOLS });
  if (message.method === 'resources/list') {
    return reply(id, {
      resources: [{
        uri: VIEWER_URI,
        name: 'viewer',
        mimeType: HTML_MIME,
        _meta: UI_META,
      }],
    });
  }
  if (message.method === 'resources/templates/list') {
    return reply(id, {
      resourceTemplates: [{
        uriTemplate: 'ui://radviewer/file/{id}/{index}',
        name: 'file',
        mimeType: 'application/octet-stream',
      }],
    });
  }
  if (message.method === 'resources/subscribe' || message.method === 'resources/unsubscribe') {
    return reply(id, {});
  }
  if (message.method === 'resources/read') {
    const uri = message.params && message.params.uri;
    if (typeof uri !== 'string' || !options.readResource) return failure(id, -32602, 'uri is required');
    try {
      return reply(id, await options.readResource(uri));
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return failure(id, -32002, text);
    }
  }
  if (message.method === 'tools/call') {
    const name = message.params && message.params.name;
    const args = message.params && message.params.arguments && typeof message.params.arguments === 'object'
      ? message.params.arguments
      : {};
    try {
      return reply(id, toolResult(await callTool(name, args)));
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

export async function handleMcpHttp(request, response, callTool, options = {}) {
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
      const result = await dispatchMessage(item, callTool, options);
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
  const result = await dispatchMessage(message, callTool, options);
  if (!result) {
    response.writeHead(202);
    response.end();
    return;
  }
  sendJson(response, 200, result);
}
