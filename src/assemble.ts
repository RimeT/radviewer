import { decodeDicom, type DicomSlice } from './dicom.ts';
import { decodeNrrd } from './nrrd.ts';
import { decodeLabels, decodeNifti } from './nifti.ts';
import { downsample } from './downsample.ts';
import { meshLabel } from './marchingCubes.ts';
import type { Dims, Modality, PreparedStudy, ScalarVolume, Vec3 } from './types.ts';
import { autoWindow } from './window.ts';

export type ProgressFn = (ratio: number) => void;

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function volumeFromSlices(slices: DicomSlice[], name: string): ScalarVolume {
  if (slices.length === 0) throw new Error('DICOM series is empty');
  const first = slices[0]!;
  const axisZ = unit(cross(first.row, first.col));
  const sorted = slices.slice().sort((a, b) => dot(a.position, axisZ) - dot(b.position, axisZ) || a.instance - b.instance);
  const unique: DicomSlice[] = [];
  for (const slice of sorted) {
    if (slice.rows !== first.rows || slice.cols !== first.cols) throw new Error('DICOM slices differ in size');
    const previous = unique[unique.length - 1];
    if (previous && Math.abs(dot(slice.position, axisZ) - dot(previous.position, axisZ)) < 0.05) continue;
    unique.push(slice);
  }
  const spacingZ = unique.length > 1
    ? Math.abs(dot(unique[1]!.position, axisZ) - dot(unique[0]!.position, axisZ)) || first.thickness || 1
    : first.thickness || 1;
  const dims: Dims = [first.cols, first.rows, unique.length];
  const values = new Int16Array(dims[0] * dims[1] * dims[2]);
  const plane = dims[0] * dims[1];
  for (let z = 0; z < unique.length; z += 1) values.set(unique[z]!.pixels, z * plane);
  const native = first.windowCenter !== undefined && first.windowWidth !== undefined && first.windowWidth > 0
    ? { center: first.windowCenter, width: first.windowWidth }
    : autoWindow(values);
  return {
    name,
    dims,
    spacing: [first.colSpacing || 1, first.rowSpacing || 1, spacingZ || 1],
    axisLps: [unit(first.row), unit(first.col), axisZ],
    values,
    modality: first.modality,
    windowCenter: native.center,
    windowWidth: native.width,
  };
}

function finish(volume: ScalarVolume, labels: PreparedStudy['labels'], report?: ProgressFn): PreparedStudy {
  report?.(0.72);
  const meshes = (labels?.classes ?? []).map((classId) => {
    const mesh = meshLabel(labels!.data, volume.dims, volume.spacing, classId);
    return { classId, positions: mesh.positions, normals: mesh.normals };
  });
  report?.(0.9);
  return {
    volume,
    labels,
    meshes,
    dvr: downsample(volume.values, volume.dims, volume.spacing),
  };
}

function detectModality(values: ArrayLike<number>): Modality {
  let min = Infinity;
  let max = -Infinity;
  const stride = Math.max(1, Math.floor(values.length / 20_000));
  for (let index = 0; index < values.length; index += stride) {
    const value = values[index]!;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min < -500 && max > 300) return 'CT';
  return 'MR';
}

export function prepareNiftiBytes(image: Uint8Array, mask: Uint8Array | undefined, name: string, report?: ProgressFn): PreparedStudy {
  report?.(0.15);
  const decoded = decodeNifti(image);
  const modality = detectModality(decoded.values);
  const window = modality === 'CT' ? { center: 40, width: 400 } : autoWindow(decoded.values);
  const volume: ScalarVolume = {
    name,
    dims: decoded.dims,
    spacing: decoded.spacing,
    axisLps: decoded.axisLps,
    values: decoded.values,
    modality,
    windowCenter: window.center,
    windowWidth: window.width,
  };
  let labels: PreparedStudy['labels'] = null;
  if (mask) {
    report?.(0.45);
    const decodedMask = decodeNifti(mask);
    if (decodedMask.dims[0] !== decoded.dims[0] || decodedMask.dims[1] !== decoded.dims[1] || decodedMask.dims[2] !== decoded.dims[2]) {
      throw new Error('Mask dimensions do not match the image');
    }
    labels = decodeLabels(decodedMask);
  }
  return finish(volume, labels, report);
}

export async function prepareNrrdBytes(image: Uint8Array, imageParts: readonly Uint8Array[] | undefined, mask: Uint8Array | undefined, maskParts: readonly Uint8Array[] | undefined, name: string, report?: ProgressFn): Promise<PreparedStudy> {
  report?.(0.15);
  const decoded = await decodeNrrd(image, imageParts);
  const modality = detectModality(decoded.values);
  const window = modality === 'CT' ? { center: 40, width: 400 } : autoWindow(decoded.values);
  const volume: ScalarVolume = {
    name,
    dims: decoded.dims,
    spacing: decoded.spacing,
    axisLps: decoded.axisLps,
    values: decoded.values,
    modality,
    windowCenter: window.center,
    windowWidth: window.width,
  };
  let labels: PreparedStudy['labels'] = null;
  if (mask) {
    report?.(0.45);
    const decodedMask = await decodeNrrd(mask, maskParts);
    if (decodedMask.dims[0] !== decoded.dims[0] || decodedMask.dims[1] !== decoded.dims[1] || decodedMask.dims[2] !== decoded.dims[2]) {
      throw new Error('Mask dimensions do not match the image');
    }
    labels = decodeLabels(decodedMask);
  }
  return finish(volume, labels, report);
}

export function prepareDicomBytes(slices: Uint8Array[], name: string, report?: ProgressFn): PreparedStudy {
  const decoded: DicomSlice[] = [];
  for (let index = 0; index < slices.length; index += 1) {
    if (index % 20 === 0) report?.(0.1 + (0.5 * index) / slices.length);
    decoded.push(decodeDicom(slices[index]!));
  }
  return finish(volumeFromSlices(decoded, name), null, report);
}
