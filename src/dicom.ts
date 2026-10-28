import type { Modality, Vec3 } from './types.ts';

const LONG_VR = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'SV', 'UC', 'UN', 'UR', 'UT']);

export interface DicomSlice {
  rows: number;
  cols: number;
  rowSpacing: number;
  colSpacing: number;
  thickness: number;
  position: Vec3;
  row: Vec3;
  col: Vec3;
  instance: number;
  slope: number;
  intercept: number;
  windowCenter?: number;
  windowWidth?: number;
  modality: Modality;
  pixels: Int16Array;
}

function tag(group: number, element: number): number {
  return (group << 16) | element;
}

function parseNumberList(text: string): number[] {
  return text.split('\\').map((part) => Number.parseFloat(part.trim())).filter((value) => Number.isFinite(value));
}

function textOf(bytes: Uint8Array, start: number, length: number): string {
  let end = start + length;
  while (end > start && (bytes[end - 1] === 0 || bytes[end - 1] === 32)) end -= 1;
  return new TextDecoder('latin1').decode(bytes.subarray(start, end)).trim();
}

/**
 * Read one uncompressed little-endian DICOM slice.
 * Explicit VR and the implicit VR that follows an explicit file meta header are both accepted.
 */
export function decodeDicom(bytes: Uint8Array): DicomSlice {
  if (bytes.length < 132 || bytes[128] !== 0x44 || bytes[129] !== 0x49 || bytes[130] !== 0x43 || bytes[131] !== 0x4d) {
    throw new Error('Not a DICOM file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 132;
  let implicit = false;
  let transfer = '1.2.840.10008.1.2.1';
  const values = new Map<number, { vr: string; offset: number; length: number }>();

  const readItem = (forceExplicit: boolean): { group: number; element: number; vr: string; length: number; value: number } | null => {
    if (offset + 8 > bytes.length) return null;
    const group = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);
    if (!forceExplicit && implicit) {
      const length = view.getUint32(offset + 4, true);
      const value = offset + 8;
      offset = value + length;
      return { group, element, vr: 'UN', length, value };
    }
    const vr = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!);
    if (!/^[A-Z]{2}$/.test(vr)) return null;
    let length: number;
    let value: number;
    if (LONG_VR.has(vr)) {
      length = view.getUint32(offset + 8, true);
      value = offset + 12;
    } else {
      length = view.getUint16(offset + 6, true);
      value = offset + 8;
    }
    if (length === 0xffffffff) throw new Error('Encapsulated DICOM pixel data is not supported');
    offset = value + length;
    return { group, element, vr, length, value };
  };

  while (offset + 8 <= bytes.length) {
    const saved = offset;
    const groupPeek = view.getUint16(offset, true);
    if (groupPeek !== 0x0002) break;
    const item = readItem(true);
    if (!item) {
      offset = saved;
      break;
    }
    if (item.element === 0x0010) transfer = textOf(bytes, item.value, item.length);
  }
  if (transfer !== '1.2.840.10008.1.2.1' && transfer !== '1.2.840.10008.1.2') {
    throw new Error(`Unsupported transfer syntax ${transfer}`);
  }
  implicit = transfer === '1.2.840.10008.1.2';

  while (offset + 8 <= bytes.length) {
    const saved = offset;
    const item = readItem(false);
    if (!item) {
      offset = saved;
      break;
    }
    const key = tag(item.group, item.element);
    values.set(key, { vr: item.vr, offset: item.value, length: item.length });
    if (key === tag(0x7fe0, 0x0010)) break;
  }

  const need = (group: number, element: number) => {
    const found = values.get(tag(group, element));
    if (!found) throw new Error(`DICOM tag (${group.toString(16)},${element.toString(16)}) is missing`);
    return found;
  };
  const textTag = (group: number, element: number, fallback = ''): string => {
    const found = values.get(tag(group, element));
    return found ? textOf(bytes, found.offset, found.length) : fallback;
  };
  const rows = view.getUint16(need(0x0028, 0x0010).offset, true);
  const cols = view.getUint16(need(0x0028, 0x0011).offset, true);
  const bits = view.getUint16(need(0x0028, 0x0100).offset, true);
  const signed = values.has(tag(0x0028, 0x0103)) ? view.getUint16(values.get(tag(0x0028, 0x0103))!.offset, true) === 1 : false;
  const spacing = parseNumberList(textTag(0x0028, 0x0030, '1\\1'));
  const position = parseNumberList(textTag(0x0020, 0x0032, '0\\0\\0'));
  const orientation = parseNumberList(textTag(0x0020, 0x0037, '1\\0\\0\\0\\1\\0'));
  const windowsC = parseNumberList(textTag(0x0028, 0x1050));
  const windowsW = parseNumberList(textTag(0x0028, 0x1051));
  const slope = Number.parseFloat(textTag(0x0028, 0x1053, '1')) || 1;
  const intercept = Number.parseFloat(textTag(0x0028, 0x1052, '0')) || 0;
  const thickness = Number.parseFloat(textTag(0x0018, 0x0050, '1')) || 1;
  const instance = Number.parseInt(textTag(0x0020, 0x0013, '0'), 10) || 0;
  const modalityText = textTag(0x0008, 0x0060, 'OT').toUpperCase();
  const modality: Modality = modalityText === 'CT' ? 'CT' : modalityText === 'MR' ? 'MR' : 'OT';
  const pixelsTag = need(0x7fe0, 0x0010);
  const count = rows * cols;
  if (bits !== 16 || pixelsTag.length < count * 2) throw new Error('Only 16-bit uncompressed DICOM pixels are supported');
  const pixels = new Int16Array(count);
  for (let index = 0; index < count; index += 1) {
    const raw = signed ? view.getInt16(pixelsTag.offset + index * 2, true) : view.getUint16(pixelsTag.offset + index * 2, true);
    pixels[index] = Math.round(raw * slope + intercept);
  }
  const row: Vec3 = [orientation[0] ?? 1, orientation[1] ?? 0, orientation[2] ?? 0];
  const col: Vec3 = [orientation[3] ?? 0, orientation[4] ?? 1, orientation[5] ?? 0];
  return {
    rows,
    cols,
    rowSpacing: spacing[0] || 1,
    colSpacing: spacing[1] || spacing[0] || 1,
    thickness,
    position: [position[0] || 0, position[1] || 0, position[2] || 0],
    row,
    col,
    instance,
    slope,
    intercept,
    windowCenter: windowsC[0],
    windowWidth: windowsW[0],
    modality,
    pixels,
  };
}
