const NIFTI_RE = /\.nii(?:\.gz)?$/i;
const NRRD_RE = /\.(?:nrrd(?:\.gz)?|nhdr)$/i;
const DICOM_RE = /\.dcm$/i;
const VOLUME_EXT = String.raw`(?:nii(?:\.gz)?|nrrd(?:\.gz)?|nhdr)`;
const LABEL_RE = new RegExp(String.raw`^(?:mask\.${VOLUME_EXT}|.+-label\.${VOLUME_EXT})$`, 'i');
const MASK_EXTS = ['nii.gz', 'nii', 'nrrd', 'nrrd.gz', 'nhdr'];

export function joinPath(dir, name) {
  const root = String(dir).replace(/\\/g, '/').replace(/\/$/, '');
  return root ? `${root}/${name}` : name;
}

export function classifyName(name) {
  if (NIFTI_RE.test(name)) return 'nifti';
  if (DICOM_RE.test(name)) return 'dicom';
  if (NRRD_RE.test(name)) return 'nrrd';
  return 'unknown';
}

function volumeStem(name) {
  return name.replace(new RegExp(String.raw`\.${VOLUME_EXT}$`, 'i'), '');
}

function maskName(image, names) {
  const stem = volumeStem(image);
  const exts = NIFTI_RE.test(image) ? ['nii.gz', 'nii'] : NRRD_RE.test(image) ? ['nrrd', 'nrrd.gz', 'nhdr'] : MASK_EXTS;
  if (/^image$/i.test(stem)) {
    for (const ext of exts) {
      const mask = `mask.${ext}`;
      if (names.has(mask)) return mask;
    }
  }
  for (const ext of exts) {
    const label = `${stem}-label.${ext}`;
    if (names.has(label)) return label;
  }
  return undefined;
}

/** Pair a directory listing into volumes. Labels are never opened as their own study. */
export function studiesFromListing(dir, entries) {
  const files = entries.filter((entry) => entry.type === 'file');
  const studies = [];
  const dicom = files.filter((entry) => DICOM_RE.test(entry.name)).map((entry) => joinPath(dir, entry.name));
  if (dicom.length > 0) {
    dicom.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const title = dir.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || 'DICOM';
    studies.push({ id: `${dir}/*.dcm`, title, kind: 'dicom', imagePaths: dicom });
  }
  const names = new Set(files.map((entry) => entry.name));
  for (const file of files) {
    const nrrd = NRRD_RE.test(file.name);
    if ((!NIFTI_RE.test(file.name) && !nrrd) || LABEL_RE.test(file.name)) continue;
    const mask = maskName(file.name, names);
    studies.push({
      id: joinPath(dir, file.name),
      title: volumeStem(file.name),
      kind: nrrd ? 'nrrd' : 'nifti',
      imagePaths: [joinPath(dir, file.name)],
      maskPath: mask ? joinPath(dir, mask) : undefined,
    });
  }
  return studies;
}
