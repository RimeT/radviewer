import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024 * 1024;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function displayPath(resolved) {
  return resolved.replace(/\\/g, '/');
}

export function assertAbsolute(input) {
  let value = typeof input === 'string' ? input.trim() : '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  if (value.includes('\0')) fail('invalid_path', 'RadViewer：路径里不能有空字节。');
  if (!value) fail('empty_path', 'RadViewer：没有给出路径。');
  const slashes = value.replace(/\\/g, '/');
  const absolute = path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(slashes);
  if (!absolute) fail('relative_path', `RadViewer 需要本机绝对路径，收到的是相对路径：${value}`);
  return path.resolve(value);
}

async function statPath(resolved) {
  try {
    return await stat(resolved);
  } catch (error) {
    if (error && error.code === 'ENOENT') fail('not_found', `RadViewer 找不到 ${displayPath(resolved)}。`);
    throw error;
  }
}

export async function listDirectory(input) {
  const resolved = assertAbsolute(input);
  const info = await statPath(resolved);
  if (!info.isDirectory()) fail('not_directory', `RadViewer：${displayPath(resolved)} 不是文件夹。`);
  const entries = await readdir(resolved, { withFileTypes: true });
  return {
    path: displayPath(resolved),
    entries: entries
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })),
  };
}

export async function openReadStream(input) {
  const resolved = assertAbsolute(input);
  const info = await statPath(resolved);
  if (!info.isFile()) fail('not_file', `RadViewer：${displayPath(resolved)} 不是文件。`);
  if (info.size > MAX_BYTES) fail('too_large', `RadViewer：${displayPath(resolved)} 超过 2 GiB。`);
  return {
    path: displayPath(resolved),
    resolved,
    size: info.size,
    stream: createReadStream(resolved),
  };
}
