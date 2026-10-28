import { inflateIfNeeded } from './inflate.ts';
import type { NiftiDecoded } from './nifti.ts';
import type { Dims, Vec3 } from './types.ts';

type ScalarType = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64';

interface Axis {
  size: number;
  spatial: boolean;
  vector: Vec3;
}

const TYPE_WIDTH: Record<ScalarType, number> = {
  i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8,
};

const TYPE_NAMES: Record<string, ScalarType> = {
  'signed char': 'i8', int8: 'i8',
  uchar: 'u8', 'unsigned char': 'u8', uint8: 'u8',
  short: 'i16', 'short int': 'i16', 'signed short': 'i16', 'signed short int': 'i16', int16: 'i16',
  ushort: 'u16', 'unsigned short': 'u16', 'unsigned short int': 'u16', uint16: 'u16',
  int: 'i32', 'signed int': 'i32', int32: 'i32',
  uint: 'u32', 'unsigned int': 'u32', uint32: 'u32',
  float: 'f32', float32: 'f32',
  double: 'f64', float64: 'f64',
};

/** Gzip around a whole NRRD is unwrapped. A gzip pixel block inside the header is left in place. */
export async function nrrdFileBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return unwrapContainer(bytes);
}

/** Relative data files named by a detached NRRD header. Empty when the pixels are attached. */
export function nrrdDataFiles(bytes: Uint8Array): string[] {
  const { fields, data } = splitHeader(bytes);
  const named = fields.get('data file');
  if (!named) return [];
  if (/^list$/i.test(named)) {
    return new TextDecoder().decode(data).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'));
  }
  return named.split(/\s+/).filter((file) => file.length > 0);
}

/** Decode an attached NRRD, or a header plus the detached data files it names. */
export async function decodeNrrd(bytes: Uint8Array, detached?: readonly Uint8Array[]): Promise<NiftiDecoded> {
  const file = await unwrapContainer(bytes);
  const { fields, data } = splitHeader(file);
  const type = TYPE_NAMES[(fields.get('type') ?? '').toLowerCase()];
  if (!type) throw new Error(`Unsupported NRRD type ${fields.get('type') ?? ''}`);
  const encoding = (fields.get('encoding') ?? 'raw').toLowerCase();
  if (encoding !== 'raw' && encoding !== 'gzip' && encoding !== 'gz' && encoding !== 'ascii' && encoding !== 'text' && encoding !== 'txt') {
    throw new Error(`Unsupported NRRD encoding ${encoding}`);
  }
  const little = (fields.get('endian') ?? 'little').toLowerCase() !== 'big';
  const byteSkip = numberField(fields, 'byte skip');
  const lineSkip = numberField(fields, 'line skip');
  const payload = await readPayload(encoding, byteSkip, detached && detached.length > 0 ? detached : [data]);
  const axes = readAxes(fields);
  return decodePayload(payload, type, little, encoding === 'ascii' || encoding === 'text' || encoding === 'txt', lineSkip, axes, fields.get('space') ?? '');
}

async function unwrapContainer(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < 4 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const inflated = await inflateIfNeeded(bytes);
  if (inflated.length >= 4 && ascii(inflated.subarray(0, 4)) === 'NRRD') return inflated;
  return bytes;
}

function splitHeader(bytes: Uint8Array): { fields: Map<string, string>; data: Uint8Array } {
  let cursor = 0;
  const lines: string[] = [];
  while (cursor < bytes.length) {
    const newline = bytes.indexOf(10, cursor);
    const end = newline < 0 ? bytes.length : newline;
    let line = bytes.subarray(cursor, end);
    if (line.length > 0 && line[line.length - 1] === 13) line = line.subarray(0, line.length - 1);
    cursor = newline < 0 ? bytes.length : newline + 1;
    if (line.length === 0) break;
    lines.push(ascii(line));
  }
  if (lines.length === 0 || !/^NRRD\d{4}$/.test(lines[0]!.trim())) throw new Error('Not an NRRD file');
  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (line.startsWith('#')) continue;
    const split = line.indexOf(':');
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    let value = line.slice(split + 1).trim();
    if (value.startsWith('=')) value = value.slice(1).trim();
    if (!fields.has(key)) fields.set(key, value);
  }
  return { fields, data: bytes.subarray(cursor) };
}

function numberField(fields: Map<string, string>, key: string): number {
  const value = Number(fields.get(key) ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

async function readPayload(encoding: string, byteSkip: number, parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    let chunk = parts[index]!;
    if (index === 0 && byteSkip > 0) chunk = chunk.subarray(Math.min(byteSkip, chunk.length));
    if (encoding === 'gzip' || encoding === 'gz') {
      if (chunk.length < 2 || chunk[0] !== 0x1f || chunk[1] !== 0x8b) throw new Error('NRRD gzip data is missing');
      chunk = await inflateIfNeeded(chunk);
    }
    chunks.push(chunk);
  }
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const payload = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.length;
  }
  return payload;
}

function readAxes(fields: Map<string, string>): Axis[] {
  const declared = numberField(fields, 'dimension');
  let sizes = (fields.get('sizes') ?? '').trim().split(/\s+/).map(Number).filter((value) => Number.isFinite(value));
  if (declared > 0 && sizes.length === declared + 1 && sizes[0] === declared) sizes = sizes.slice(1);
  if (sizes.length < 3 || sizes.some((size) => size <= 0)) throw new Error('NRRD sizes are invalid');
  const directions = readDirections(fields.get('space directions') ?? '');
  const spacings = (fields.get('spacings') ?? '').trim().split(/\s+/).map(Number);
  const kinds = (fields.get('kinds') ?? '').trim().split(/\s+/).filter((kind) => kind.length > 0);
  return sizes.map((size, index) => {
    const direction = directions[index];
    const kind = (kinds[index] ?? '').toLowerCase();
    const nonSpatialKind = /vector|rgb|rgba|normal|point|covariant|stub|complex|quaternion/.test(kind);
    const spatial = direction ? direction.spatial && !nonSpatialKind : index < 3 && !nonSpatialKind;
    const spacing = Math.abs(spacings[index] ?? 1) || 1;
    const vector: Vec3 = direction?.vector ?? [index === 0 ? spacing : 0, index === 1 ? spacing : 0, index === 2 ? spacing : 0];
    if (nonSpatialKind && size > 1) throw new Error('NRRD vector images are not supported');
    return { size, spatial, vector };
  });
}

function readDirections(text: string): { spatial: boolean; vector: Vec3 }[] {
  if (!text.trim()) return [];
  const found: { spatial: boolean; vector: Vec3 }[] = [];
  const pattern = /\((-?[\d.]+(?:e[-+]?\d+)?)\s*,\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*,\s*(-?[\d.]+(?:e[-+]?\d+)?)\)|none/gi;
  for (const match of text.matchAll(pattern)) {
    if (/^none$/i.test(match[0]!)) found.push({ spatial: false, vector: [0, 0, 0] });
    else found.push({ spatial: true, vector: [Number(match[1]), Number(match[2]), Number(match[3])] });
  }
  return found;
}

function decodePayload(payload: Uint8Array, type: ScalarType, little: boolean, ascii: boolean, lineSkip: number, axes: Axis[], space: string): NiftiDecoded {
  const spatial = axes.map((axis, index) => ({ axis, index })).filter((item) => item.axis.spatial);
  if (spatial.length < 3) throw new Error('NRRD volume has fewer than 3 dimensions');
  const [x, y, z] = spatial;
  const dims: Dims = [x!.axis.size, y!.axis.size, z!.axis.size];
  const voxels = dims[0] * dims[1] * dims[2];
  const strides: number[] = [];
  let step = 1;
  for (const axis of axes) {
    strides.push(step);
    step *= axis.size;
  }
  const read = ascii ? asciiReader(payload, lineSkip) : binaryReader(payload, type, little);
  const width = TYPE_WIDTH[type];
  if (!ascii && payload.byteLength < step * width) throw new Error('NRRD data is shorter than its sizes');
  let min = Infinity;
  let max = -Infinity;
  const sample = (xIndex: number, yIndex: number, zIndex: number) => read(xIndex * strides[x!.index]! + yIndex * strides[y!.index]! + zIndex * strides[z!.index]!);
  for (let zIndex = 0; zIndex < dims[2]; zIndex += 1) {
    for (let yIndex = 0; yIndex < dims[1]; yIndex += 1) {
      for (let xIndex = 0; xIndex < dims[0]; xIndex += 1) {
        const value = sample(xIndex, yIndex, zIndex);
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
  }
  const integer = type !== 'f32' && type !== 'f64';
  const values = integer && min >= -32768 && max <= 32767 ? new Int16Array(voxels) : new Float32Array(voxels);
  let cursor = 0;
  for (let zIndex = 0; zIndex < dims[2]; zIndex += 1) {
    for (let yIndex = 0; yIndex < dims[1]; yIndex += 1) {
      for (let xIndex = 0; xIndex < dims[0]; xIndex += 1) {
        const value = sample(xIndex, yIndex, zIndex);
        values[cursor] = values instanceof Int16Array ? Math.round(value) : value;
        cursor += 1;
      }
    }
  }
  const oriented = [x!, y!, z!].map((item) => toLps(item.axis.vector, space));
  const spacing = oriented.map((vector) => Math.hypot(vector[0], vector[1], vector[2]) || 1) as Vec3;
  const axisLps = oriented.map((vector) => unit(vector)) as [Vec3, Vec3, Vec3];
  return { dims, spacing, axisLps, values };
}

function toLps(vector: Vec3, space: string): Vec3 {
  const name = space.toLowerCase().replace(/_/g, '-');
  if (name === 'ras' || name === 'right-anterior-superior') return [-vector[0], -vector[1], vector[2]];
  return vector;
}

function unit(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function binaryReader(payload: Uint8Array, type: ScalarType, little: boolean): (index: number) => number {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const width = TYPE_WIDTH[type];
  return (index) => {
    const offset = index * width;
    switch (type) {
      case 'i8': return view.getInt8(offset);
      case 'u8': return view.getUint8(offset);
      case 'i16': return view.getInt16(offset, little);
      case 'u16': return view.getUint16(offset, little);
      case 'i32': return view.getInt32(offset, little);
      case 'u32': return view.getUint32(offset, little);
      case 'f32': return view.getFloat32(offset, little);
      case 'f64': return view.getFloat64(offset, little);
      default: return 0;
    }
  };
}

function asciiReader(payload: Uint8Array, lineSkip: number): (index: number) => number {
  const lines = ascii(payload).split(/\r?\n/);
  const numbers = lines.slice(lineSkip).join(' ').trim().split(/\s+/).map(Number);
  return (index) => {
    const value = numbers[index];
    if (value === undefined || !Number.isFinite(value)) throw new Error('NRRD text data is shorter than its sizes');
    return value;
  };
}

function ascii(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]!);
  return text;
}
