import type { Axis, PlaneMap, Vec3 } from './types.ts';

const POS = ['L', 'P', 'S'] as const;
const NEG = ['R', 'A', 'I'] as const;

function axisFor(component: Axis, axes: [Vec3, Vec3, Vec3]): { axis: Axis; sign: 1 | -1 } {
  let best: Axis = 0;
  let mag = -1;
  for (let index = 0; index < 3; index += 1) {
    const value = Math.abs(axes[index]![component]);
    if (value > mag) {
      mag = value;
      best = index as Axis;
    }
  }
  return { axis: best, sign: axes[best]![component] >= 0 ? 1 : -1 };
}

function nameAlong(axes: [Vec3, Vec3, Vec3], axis: Axis, direction: 1 | -1): string {
  const source = axes[axis]!;
  const vector = [source[0] * direction, source[1] * direction, source[2] * direction];
  let dominant: Axis = 0;
  if (Math.abs(vector[1]!) > Math.abs(vector[dominant]!)) dominant = 1;
  if (Math.abs(vector[2]!) > Math.abs(vector[dominant]!)) dominant = 2;
  return (vector[dominant]! >= 0 ? POS[dominant] : NEG[dominant]) ?? 'S';
}

function plane(
  id: PlaneMap['id'],
  fixedAxis: Axis,
  uAxis: Axis,
  uSign: 1 | -1,
  vAxis: Axis,
  vSign: 1 | -1,
  axes: [Vec3, Vec3, Vec3],
): PlaneMap {
  return {
    id,
    fixedAxis,
    uAxis,
    vAxis,
    uSign,
    vSign,
    left: nameAlong(axes, uAxis, (uSign * -1) as 1 | -1),
    right: nameAlong(axes, uAxis, uSign),
    top: nameAlong(axes, vAxis, (vSign * -1) as 1 | -1),
    bottom: nameAlong(axes, vAxis, vSign),
  };
}

/** Orthogonal planes whose screen axes follow radiological LPS conventions. */
export function planesFromAxes(axes: [Vec3, Vec3, Vec3]): [PlaneMap, PlaneMap, PlaneMap] {
  const left = axisFor(0, axes);
  const posterior = axisFor(1, axes);
  const superior = axisFor(2, axes);
  const downSign = (superior.sign * -1) as 1 | -1;
  return [
    plane('axial', superior.axis, left.axis, left.sign, posterior.axis, posterior.sign, axes),
    plane('sagittal', left.axis, posterior.axis, posterior.sign, superior.axis, downSign, axes),
    plane('coronal', posterior.axis, left.axis, left.sign, superior.axis, downSign, axes),
  ];
}

export function screenToVoxel(planeMap: PlaneMap, fixed: number, sx: number, sy: number, dims: [number, number, number]): [number, number, number] {
  const coord: [number, number, number] = [0, 0, 0];
  const uCount = dims[planeMap.uAxis];
  const vCount = dims[planeMap.vAxis];
  coord[planeMap.fixedAxis] = fixed;
  coord[planeMap.uAxis] = planeMap.uSign > 0 ? sx : uCount - 1 - sx;
  coord[planeMap.vAxis] = planeMap.vSign > 0 ? sy : vCount - 1 - sy;
  return coord;
}

export function voxelToScreen(planeMap: PlaneMap, ijk: [number, number, number], dims: [number, number, number]): { sx: number; sy: number } {
  const u = ijk[planeMap.uAxis];
  const v = ijk[planeMap.vAxis];
  const uCount = dims[planeMap.uAxis];
  const vCount = dims[planeMap.vAxis];
  return {
    sx: planeMap.uSign > 0 ? u : uCount - 1 - u,
    sy: planeMap.vSign > 0 ? v : vCount - 1 - v,
  };
}
