import type { Dims, Vec3 } from './types.ts';

const DT_UINT8 = 2;
const DT_INT16 = 4;
const DT_INT32 = 8;
const DT_FLOAT32 = 16;
const DT_FLOAT64 = 64;
const DT_INT8 = 256;
const DT_UINT16 = 512;
const DT_UINT32 = 768;

export interface NiftiDecoded {
  dims: Dims;
  spacing: Vec3;
  axisLps: [Vec3, Vec3, Vec3];
  values: Int16Array | Float32Array;
}

function floatAt(view: DataView, offset: number): number {
  return view.getFloat32(offset, true);
}

function unit(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function axesFromHeader(view: DataView, pixdim: Vec3): { spacing: Vec3; axisLps: [Vec3, Vec3, Vec3] } {
  const sform = view.getInt16(254, true);
  if (sform > 0) {
    const columns: Vec3[] = [0, 1, 2].map((column) => [
      floatAt(view, 280 + column * 4),
      floatAt(view, 296 + column * 4),
      floatAt(view, 312 + column * 4),
    ] as Vec3);
    const spacing = columns.map((column) => Math.hypot(column[0], column[1], column[2]) || 1) as Vec3;
    return { spacing, axisLps: columns.map((column) => unit(column)) as [Vec3, Vec3, Vec3] };
  }
  const spacing: Vec3 = [Math.abs(pixdim[0]) || 1, Math.abs(pixdim[1]) || 1, Math.abs(pixdim[2]) || 1];
  const axisLps: [Vec3, Vec3, Vec3] = [
    [pixdim[0] >= 0 ? 1 : -1, 0, 0],
    [0, pixdim[1] >= 0 ? 1 : -1, 0],
    [0, 0, pixdim[2] >= 0 ? 1 : -1],
  ];
  return { spacing, axisLps };
}

function fitsInt16(min: number, max: number): boolean {
  return min >= -32768 && max <= 32767;
}

/** Decode one uncompressed NIfTI-1 volume. Gzip must already be inflated. */
export function decodeNifti(bytes: Uint8Array): NiftiDecoded {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getInt32(0, true) === 348;
  if (!little && view.getInt32(0, false) !== 348) throw new Error('Not a NIfTI-1 file');
  if (!little) throw new Error('Big-endian NIfTI is not supported');
  const nd = view.getInt16(40, true);
  if (nd < 3) throw new Error('NIfTI volume has fewer than 3 dimensions');
  const dims: Dims = [view.getInt16(42, true), view.getInt16(44, true), view.getInt16(46, true)];
  if (dims.some((dim) => dim <= 0)) throw new Error('NIfTI dimensions are invalid');
  const extra = nd >= 4 ? view.getInt16(48, true) : 1;
  if (extra > 1) {
    /* The first volume of a time series is the one we can show. */
  }
  const datatype = view.getInt16(70, true);
  const pixdim: Vec3 = [floatAt(view, 80), floatAt(view, 84), floatAt(view, 88)];
  let slope = floatAt(view, 112);
  const intercept = floatAt(view, 116);
  if (!Number.isFinite(slope) || slope === 0) slope = 1;
  let dataOffset = Math.round(floatAt(view, 108));
  if (!Number.isFinite(dataOffset) || dataOffset < 352) dataOffset = 352;
  const voxels = dims[0] * dims[1] * dims[2];
  const { spacing, axisLps } = axesFromHeader(view, pixdim);

  const read = readerFor(datatype);
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < voxels; index += 1) {
    const value = read(view, dataOffset, index) * slope + intercept;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const integerSource = datatype !== DT_FLOAT32 && datatype !== DT_FLOAT64;
  if (integerSource && fitsInt16(min, max)) {
    const values = new Int16Array(voxels);
    for (let index = 0; index < voxels; index += 1) {
      values[index] = Math.round(read(view, dataOffset, index) * slope + intercept);
    }
    return { dims, spacing, axisLps, values };
  }
  const values = new Float32Array(voxels);
  for (let index = 0; index < voxels; index += 1) {
    const value = read(view, dataOffset, index) * slope + intercept;
    values[index] = Number.isFinite(value) ? value : 0;
  }
  return { dims, spacing, axisLps, values };
}

function readerFor(datatype: number): (view: DataView, offset: number, index: number) => number {
  switch (datatype) {
    case DT_UINT8:
      return (view, offset, index) => view.getUint8(offset + index);
    case DT_INT8:
      return (view, offset, index) => view.getInt8(offset + index);
    case DT_UINT16:
      return (view, offset, index) => view.getUint16(offset + index * 2, true);
    case DT_INT16:
      return (view, offset, index) => view.getInt16(offset + index * 2, true);
    case DT_UINT32:
      return (view, offset, index) => view.getUint32(offset + index * 4, true);
    case DT_INT32:
      return (view, offset, index) => view.getInt32(offset + index * 4, true);
    case DT_FLOAT32:
      return (view, offset, index) => view.getFloat32(offset + index * 4, true);
    case DT_FLOAT64:
      return (view, offset, index) => view.getFloat64(offset + index * 8, true);
    default:
      throw new Error(`Unsupported NIfTI datatype ${datatype}`);
  }
}

/** Label voxels as uint8 class ids. Values outside 0..255 are rejected. */
export function decodeLabels(decoded: NiftiDecoded): { data: Uint8Array; classes: number[] } {
  const data = new Uint8Array(decoded.values.length);
  const present = new Set<number>();
  for (let index = 0; index < decoded.values.length; index += 1) {
    const value = Math.round(decoded.values[index]!);
    if (value < 0 || value > 255) throw new Error(`Mask class ${value} is outside 0..255`);
    data[index] = value;
    if (value !== 0) present.add(value);
  }
  return { data, classes: [...present].sort((a, b) => a - b) };
}
