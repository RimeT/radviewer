import { randomBytes } from 'node:crypto';
import { describeFile, listDirectory, readFileSlice } from './files.mjs';
import { listStudies, resolveOpen } from './open.mjs';
import { HTML_MIME, UI_META, VIEWER_URI, viewerDocument } from './panel.mjs';

export const FILE_CHUNK_BYTES = 2 * 1024 * 1024;

const files = new Map();
let openState = null;
let nextOpenId = 1;

function rememberOpen(opened) {
  openState = {
    id: nextOpenId,
    path: opened.path,
    format: opened.format,
    folder: opened.folder,
  };
  nextOpenId += 1;
  return openState;
}

function rememberFile(resolved, size) {
  const id = randomBytes(8).toString('hex');
  files.set(id, { resolved, size });
  while (files.size > 512) files.delete(files.keys().next().value);
  return id;
}

export function currentOpen() {
  return openState;
}

export async function callViewerTool(name, args) {
  const raw = args && typeof args.path === 'string' ? args.path : '';
  if (name === 'list_studies') {
    const listed = await listStudies(raw);
    const state = rememberOpen({ path: listed.folder, format: 'folder', folder: listed.folder });
    return { text: listed.message, structured: { path: state.path, folder: listed.folder, id: state.id } };
  }
  if (name === 'open_study') {
    const opened = await resolveOpen(raw);
    const state = rememberOpen(opened);
    return {
      text: opened.message,
      structured: { path: state.path, format: opened.format, folder: opened.folder, id: state.id },
      opened,
    };
  }
  if (name === 'list_directory') {
    const value = await listDirectory(raw);
    return { text: value.path, structured: { ok: true, value } };
  }
  if (name === 'read_file') {
    const file = await describeFile(raw);
    const id = rememberFile(file.resolved, file.size);
    const chunks = file.size === 0 ? 0 : Math.ceil(file.size / FILE_CHUNK_BYTES);
    return {
      text: `${file.path} ${file.size}`,
      structured: { id, size: file.size, chunkBytes: FILE_CHUNK_BYTES, chunks },
    };
  }
  if (name === 'viewer_state') {
    const state = openState ?? { id: 0, path: '' };
    return { text: state.path || '', structured: state };
  }
  throw new Error(`Unknown tool ${name}`);
}

export async function readPluginResource(uri) {
  if (uri === VIEWER_URI) {
    return {
      contents: [{
        uri,
        mimeType: HTML_MIME,
        text: await viewerDocument(),
        _meta: UI_META,
      }],
    };
  }
  const match = /^ui:\/\/radviewer\/file\/([0-9a-f]{16})\/(\d+)$/.exec(uri);
  if (!match) {
    const error = new Error(`RadViewer：没有这个资源 ${uri}`);
    error.code = 'not_found';
    throw error;
  }
  const record = files.get(match[1]);
  if (!record) throw new Error('RadViewer：文件读取已过期，请重新打开。');
  const index = Number(match[2]);
  const offset = index * FILE_CHUNK_BYTES;
  if (record.size === 0 || offset >= record.size) throw new Error('RadViewer：文件分片超出范围。');
  const length = Math.min(FILE_CHUNK_BYTES, record.size - offset);
  const bytes = await readFileSlice(record.resolved, offset, length);
  return {
    contents: [{
      uri,
      mimeType: 'application/octet-stream',
      blob: bytes.toString('base64'),
    }],
  };
}
