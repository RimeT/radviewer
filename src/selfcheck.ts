import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { prepareDicomBytes, prepareNiftiBytes, prepareNrrdBytes, volumeFromSlices } from './assemble.ts';
import { decodeNrrd, nrrdDataFiles } from './nrrd.ts';
import { decodeDicom } from './dicom.ts';
import { meshLabel } from './marchingCubes.ts';
import { planesFromAxes } from './planes.ts';
import { pairSiblingMasks, studiesFromListing } from './study.ts';
import type { Vec3 } from './types.ts';

function loadMaybeGzip(path: string): Uint8Array {
  const bytes = readFileSync(path);
  const inflated = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function edgeKey(positions: Float32Array, a: number, b: number): string {
  const first = [0, 1, 2].map((axis) => Math.round(positions[a + axis]! * 20)).join(',');
  const second = [0, 1, 2].map((axis) => Math.round(positions[b + axis]! * 20)).join(',');
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function assertClosed(positions: Float32Array, label: string): void {
  const counts = new Map<string, number>();
  for (let index = 0; index < positions.length; index += 9) {
    for (const [start, end] of [[0, 3], [3, 6], [6, 0]] as const) {
      const key = edgeKey(positions, index + start, index + end);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const count of counts.values()) if (count !== 2) open += 1;
  assert(open === 0, `${label} mesh has ${open} open edges`);
}

const identity: [Vec3, Vec3, Vec3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const [axial, sagittal, coronal] = planesFromAxes(identity);
assert(axial.left === 'R' && axial.right === 'L' && axial.top === 'A' && axial.bottom === 'P', `axial markers ${axial.left}${axial.right}${axial.top}${axial.bottom}`);
assert(sagittal.left === 'A' && sagittal.right === 'P' && sagittal.top === 'S' && sagittal.bottom === 'I', `sagittal markers ${sagittal.left}${sagittal.right}${sagittal.top}${sagittal.bottom}`);
assert(coronal.left === 'R' && coronal.right === 'L' && coronal.top === 'S' && coronal.bottom === 'I', `coronal markers ${coronal.left}${coronal.right}${coronal.top}${coronal.bottom}`);

const cubeLabels = new Uint8Array(6 * 6 * 6);
for (let z = 1; z <= 4; z += 1) {
  for (let y = 1; y <= 4; y += 1) {
    for (let x = 1; x <= 4; x += 1) cubeLabels[x + y * 6 + z * 36] = 1;
  }
}
const cube = meshLabel(cubeLabels, [6, 6, 6], [1, 1, 1], 1);
assert(cube.positions.length > 0, 'cube mesh empty');
assertClosed(cube.positions, 'cube');

const studies = studiesFromListing('samples/P001-1', [
  { name: 'P001-1-ED.nii.gz', type: 'file' },
  { name: 'P001-1-ED-label.nii.gz', type: 'file' },
  { name: 'P001-1-ES.nii.gz', type: 'file' },
  { name: 'P001-1-ES-label.nii.gz', type: 'file' },
]);
assert(studies.length === 2 && studies[0]?.maskPath?.endsWith('ED-label.nii.gz'), 'ED/ES pairing failed');
const cas = studiesFromListing('samples/cas045', [
  { name: 'image.nii.gz', type: 'file' },
  { name: 'mask.nii.gz', type: 'file' },
]);
assert(cas.length === 1 && cas[0]?.maskPath === 'samples/cas045/mask.nii.gz', 'image/mask pairing failed');
const sibling = pairSiblingMasks([
  { id: 'case/data/045.nii.gz', title: '045', kind: 'nifti', imagePaths: ['case/data/045.nii.gz'] },
  { id: 'case/mask/045.nii.gz', title: '045', kind: 'nifti', imagePaths: ['case/mask/045.nii.gz'] },
]);
assert(sibling.length === 1 && sibling[0]?.maskPath === 'case/mask/045.nii.gz', 'data/mask sibling pairing failed');
const dicomListing = studiesFromListing('samples/MonoE_40keV', [
  { name: 'Image0002.dcm', type: 'file' },
  { name: 'Image0001.dcm', type: 'file' },
]);
assert(dicomListing[0]?.imagePaths[0]?.endsWith('Image0001.dcm'), 'DICOM sort failed');

const hasSamples = existsSync('samples/cas045/image.nii.gz')
  && existsSync('samples/P001-1/P001-1-ED.nii.gz')
  && existsSync('samples/MonoE_40keV/Image0001.dcm');
if (hasSamples) {
const casStudy = prepareNiftiBytes(loadMaybeGzip('samples/cas045/image.nii.gz'), loadMaybeGzip('samples/cas045/mask.nii.gz'), 'cas045');
assert(casStudy.volume.dims.join('x') === '278x320x95', `cas dims ${casStudy.volume.dims}`);
assert(casStudy.labels?.classes.join(',') === '1', `cas classes ${casStudy.labels?.classes}`);
assert(casStudy.meshes[0]!.positions.length > 100, 'cas mesh empty');
assert(casStudy.dvr.dims[0] <= 256 && casStudy.dvr.dims[1] <= 256 && casStudy.dvr.dims[2] <= 256, 'dvr too large');

const ed = prepareNiftiBytes(loadMaybeGzip('samples/P001-1/P001-1-ED.nii.gz'), loadMaybeGzip('samples/P001-1/P001-1-ED-label.nii.gz'), 'ED');
assert(ed.volume.dims.join('x') === '480x512x11', `ed dims ${ed.volume.dims}`);
assert(ed.labels?.classes.join(',') === '1,2,3', `ed classes ${ed.labels?.classes}`);
assert(ed.meshes.length === 3 && ed.meshes.every((mesh) => mesh.positions.length > 0), 'ED meshes missing');
assert(Math.abs(ed.volume.spacing[2] - 10) < 0.2, `ED spacing z ${ed.volume.spacing[2]}`);

const one = decodeDicom(readFileSync('samples/MonoE_40keV/Image0001.dcm'));
const mid = decodeDicom(readFileSync('samples/MonoE_40keV/Image0190.dcm'));
const last = decodeDicom(readFileSync('samples/MonoE_40keV/Image0380.dcm'));
assert(one.rows === 512 && one.cols === 512 && one.modality === 'CT', 'dicom header');
assert(one.pixels[one.pixels.length >> 1] !== 0 || one.intercept === -1024, 'dicom rescale');
const series = volumeFromSlices([last, one, mid], 'mono');
assert(series.dims[2] === 3, 'series count');
assert(series.axisLps[2][2]! > 0.9, 'axial normal');
assert(series.windowCenter === 35 && series.windowWidth === 70, `window ${series.windowCenter}/${series.windowWidth}`);

const preparedDicom = prepareDicomBytes([
  readFileSync('samples/MonoE_40keV/Image0001.dcm'),
  readFileSync('samples/MonoE_40keV/Image0002.dcm'),
], 'pair');
assert(preparedDicom.volume.dims[2] === 2, 'two-slice series');
assert(Math.abs(preparedDicom.volume.spacing[2] - 1) < 0.05, `adjacent spacing ${preparedDicom.volume.spacing[2]}`);
assert(preparedDicom.labels === null, 'dicom mask');
console.log('selfcheck samples ok', {
  casSpacing: casStudy.volume.spacing.map((value) => Number(value.toFixed(3))),
  edSpacing: ed.volume.spacing.map((value) => Number(value.toFixed(3))),
  casMesh: casStudy.meshes[0]!.positions.length / 9,
  edClasses: ed.labels?.classes,
  dicomZ: Number(series.spacing[2].toFixed(3)),
});
}

const nrrdStudies = studiesFromListing('samples/nrrd', [
  { name: 'image.nrrd', type: 'file' },
  { name: 'mask.nrrd', type: 'file' },
  { name: 'vol.nhdr', type: 'file' },
  { name: 'vol-label.nhdr', type: 'file' },
]);
assert(nrrdStudies.length === 2, `nrrd studies ${nrrdStudies.length}`);
assert(nrrdStudies[0]?.kind === 'nrrd' && nrrdStudies[0]?.maskPath === 'samples/nrrd/mask.nrrd', 'nrrd mask pairing');
assert(nrrdStudies[1]?.maskPath === 'samples/nrrd/vol-label.nhdr', 'nhdr label pairing');

const nrrdRaw = new Uint8Array(64 * 2);
const nrrdView = new DataView(nrrdRaw.buffer);
for (let z = 0; z < 4; z += 1) {
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) nrrdView.setInt16((x + y * 4 + z * 16) * 2, x + 10 * y + 100 * z, true);
  }
}
const nrrdMask = new Uint8Array(64);
for (let z = 1; z <= 2; z += 1) {
  for (let y = 1; y <= 2; y += 1) {
    for (let x = 1; x <= 2; x += 1) nrrdMask[x + y * 4 + z * 16] = 1;
  }
}
const nrrdHead = `NRRD0004
type: short
dimension: 3
space: left-posterior-superior
sizes: 4 4 4
space directions: (2,0,0) (0,3,0) (0,0,4)
encoding: raw
endian: little
`;
const attachNrrd = (text: string, data: Uint8Array) => {
  const head = new TextEncoder().encode(`${text.trim()}\n\n`);
  const out = new Uint8Array(head.length + data.length);
  out.set(head);
  out.set(data, head.length);
  return out;
};
const nrrdImage = attachNrrd(nrrdHead, nrrdRaw);
const nrrdLabel = attachNrrd(nrrdHead.replace('type: short', 'type: uchar'), nrrdMask);
const nrrdStudy = await prepareNrrdBytes(nrrdImage, undefined, nrrdLabel, undefined, 'nrrd');
assert(nrrdStudy.volume.dims.join('x') === '4x4x4', `nrrd dims ${nrrdStudy.volume.dims}`);
assert(nrrdStudy.volume.values[1 + 2 * 4 + 3 * 16] === 321, `nrrd voxel ${nrrdStudy.volume.values[57]}`);
assert(nrrdStudy.volume.spacing.join(',') === '2,3,4', `nrrd spacing ${nrrdStudy.volume.spacing}`);
assert(nrrdStudy.volume.axisLps[0][0] === 1 && nrrdStudy.volume.axisLps[1][1] === 1, 'nrrd LPS axes');
assert(nrrdStudy.labels?.classes.join(',') === '1', `nrrd classes ${nrrdStudy.labels?.classes}`);
assert(nrrdStudy.meshes[0]!.positions.length > 0, 'nrrd mesh empty');

const ras = await decodeNrrd(attachNrrd(nrrdHead.replace('left-posterior-superior', 'right-anterior-superior'), nrrdRaw));
assert(ras.axisLps[0][0] === -1 && ras.axisLps[1][1] === -1 && ras.axisLps[2][2] === 1, `nrrd RAS ${ras.axisLps}`);

const detachedHeader = new TextEncoder().encode(`${nrrdHead.trim()}\ndata file: vol.raw\n\n`);
assert(nrrdDataFiles(detachedHeader).join() === 'vol.raw', 'nrrd data file');
const detached = await decodeNrrd(detachedHeader, [nrrdRaw]);
assert(detached.values[57] === 321, 'detached nrrd');

const gzipped = attachNrrd(nrrdHead.replace('encoding: raw', 'encoding: gzip'), gzipSync(nrrdRaw));
const fromGzip = await decodeNrrd(gzipped);
assert(fromGzip.values[57] === 321, 'gzip nrrd');
const wrapped = new Uint8Array(gzipSync(nrrdImage));
const fromWrapped = await decodeNrrd(wrapped);
assert(fromWrapped.values[57] === 321, 'nrrd.gz');

console.log('selfcheck ok');
