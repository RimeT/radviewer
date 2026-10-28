import path from 'node:path';
import { classifyName, joinPath, pairSiblingMasks, studiesFromListing } from './catalog.mjs';
import { assertAbsolute, displayPath, listDirectory } from './files.mjs';
import { stat } from 'node:fs/promises';

const CHILD_CAP = 64;
const LIST_CAP = 40;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export async function listStudies(input) {
  const root = await listDirectory(input);
  const found = studiesFromListing(root.path, root.entries);
  const subs = root.entries.filter((entry) => entry.type === 'directory');
  for (const entry of subs.slice(0, CHILD_CAP)) {
    try {
      const child = await listDirectory(joinPath(root.path, entry.name));
      found.push(...studiesFromListing(child.path, child.entries));
    } catch {
      /* an unreadable child does not hide the studies that did open */
    }
  }
  const paired = pairSiblingMasks(found);
  const shown = paired.slice(0, LIST_CAP).map((study, index) => {
    const mask = study.maskPath ? `，mask ${study.maskPath}` : '';
    return `${index + 1}. ${study.title}（${study.kind}）${study.imagePaths[0]}${mask}`;
  });
  const more = paired.length > LIST_CAP ? `\n其余 ${paired.length - LIST_CAP} 套未列出。` : '';
  const tail = subs.length > CHILD_CAP ? '\n只扫描了前 64 个子文件夹。' : '';
  const message = paired.length === 0
    ? `RadViewer：${root.path} 里没有 DICOM 序列、NIfTI 或 NRRD。`
    : `RadViewer：在 ${root.path} 找到 ${paired.length} 套检查。\n${shown.join('\n')}${more}${tail}`;
  return { folder: root.path, studies: paired, truncated: subs.length > CHILD_CAP, message };
}

export async function resolveOpen(input) {
  const target = assertAbsolute(input);
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') fail('not_found', `RadViewer 找不到 ${displayPath(target)}。`);
    throw error;
  }
  if (info.isFile()) {
    const format = classifyName(path.basename(target));
    if (format === 'unknown') fail('unsupported', `RadViewer：${displayPath(target)} 不是 DICOM、NIfTI 或 NRRD。`);
    const shown = displayPath(target);
    return {
      path: shown,
      format,
      folder: displayPath(path.dirname(target)),
      studyCount: 1,
      title: path.basename(target),
      message: `RadViewer：打开 ${shown}。`,
    };
  }
  if (!info.isDirectory()) fail('unsupported', `RadViewer：${displayPath(target)} 不是文件或文件夹。`);
  const listed = await listStudies(target);
  const study = listed.studies[0];
  if (!study) fail('empty', listed.message);
  const file = study.imagePaths[0];
  const message = listed.studies.length > 1
    ? `RadViewer：这个位置有 ${listed.studies.length} 套检查，已打开「${study.title}」（${file}）。要换一套，先调用 list_studies。`
    : `RadViewer：打开 ${file}。`;
  return {
    path: file,
    format: study.kind,
    folder: listed.folder,
    studyCount: listed.studies.length,
    title: study.title,
    message,
  };
}
