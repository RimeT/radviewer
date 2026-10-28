import { classColor } from './palette.ts';
import type { PlaneMap, ScalarVolume } from './types.ts';

export interface SliceView {
  center: number;
  width: number;
  opacity: number;
  hidden: ReadonlySet<number>;
}

const stridesOf = (dims: [number, number, number]) => [1, dims[0], dims[0] * dims[1]] as const;

/** Paint one orthogonal slice, with optional class tint and a one-pixel contour. */
export function renderSlice(
  volume: ScalarVolume,
  labels: Uint8Array | null,
  plane: PlaneMap,
  fixed: number,
  view: SliceView,
  target: Uint8ClampedArray,
): void {
  const uCount = volume.dims[plane.uAxis];
  const vCount = volume.dims[plane.vAxis];
  const strides = stridesOf(volume.dims);
  const origin: [number, number, number] = [0, 0, 0];
  origin[plane.fixedAxis] = fixed;
  origin[plane.uAxis] = plane.uSign > 0 ? 0 : volume.dims[plane.uAxis] - 1;
  origin[plane.vAxis] = plane.vSign > 0 ? 0 : volume.dims[plane.vAxis] - 1;
  const uStride = strides[plane.uAxis] * plane.uSign;
  const vStride = strides[plane.vAxis] * plane.vSign;
  let row = origin[0] + origin[1] * strides[1] + origin[2] * strides[2];
  const low = view.center - view.width / 2;
  const inv = view.width > 0 ? 255 / view.width : 0;
  const opacity = view.opacity;
  const values = volume.values;

  for (let sy = 0; sy < vCount; sy += 1) {
    let index = row;
    const rowOffset = sy * uCount * 4;
    for (let sx = 0; sx < uCount; sx += 1) {
      const sample = values[index] ?? 0;
      let gray = (sample - low) * inv;
      if (gray < 0) gray = 0;
      else if (gray > 255) gray = 255;
      let red = gray;
      let green = gray;
      let blue = gray;
      if (labels) {
        const label = labels[index] ?? 0;
        const shown = label !== 0 && !view.hidden.has(label) ? label : 0;
        if (shown !== 0) {
          const color = classColor(shown);
          const left = sx > 0 ? (labels[index - uStride] ?? 0) : 0;
          const up = sy > 0 ? (labels[index - vStride] ?? 0) : 0;
          const leftShown = left !== 0 && !view.hidden.has(left) ? left : 0;
          const upShown = up !== 0 && !view.hidden.has(up) ? up : 0;
          const mix = leftShown !== shown || upShown !== shown ? 0.92 : opacity;
          red = gray * (1 - mix) + color[0] * mix;
          green = gray * (1 - mix) + color[1] * mix;
          blue = gray * (1 - mix) + color[2] * mix;
        }
      }
      const pixel = rowOffset + sx * 4;
      target[pixel] = red;
      target[pixel + 1] = green;
      target[pixel + 2] = blue;
      target[pixel + 3] = 255;
      index += uStride;
    }
    row += vStride;
  }
}

export function sampleValue(volume: ScalarVolume, x: number, y: number, z: number): number {
  const dims = volume.dims;
  if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) return 0;
  return volume.values[x + dims[0] * (y + dims[1] * z)] ?? 0;
}
