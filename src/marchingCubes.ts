import { EDGE_TABLE, TRI_TABLE } from './mcTables.ts';
import type { Dims, Vec3 } from './types.ts';

const EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const CORNER_OFFSETS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

export interface RawMesh {
  positions: Float32Array;
  normals: Float32Array;
}

/** Binary marching cubes around one label class. Positions are millimeters from the volume origin. */
export function meshLabel(labels: Uint8Array, dims: Dims, spacing: Vec3, classId: number): RawMesh {
  let x0 = dims[0];
  let y0 = dims[1];
  let z0 = dims[2];
  let x1 = -1;
  let y1 = -1;
  let z1 = -1;
  const dx = dims[0];
  const dy = dims[1];
  const plane = dx * dy;
  for (let z = 0; z < dims[2]; z += 1) {
    for (let y = 0; y < dims[1]; y += 1) {
      let index = z * plane + y * dx;
      for (let x = 0; x < dims[0]; x += 1) {
        if (labels[index] === classId) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (z < z0) z0 = z;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
          if (z > z1) z1 = z;
        }
        index += 1;
      }
    }
  }
  if (x1 < 0) return { positions: new Float32Array(), normals: new Float32Array() };

  const positions: number[] = [];
  const corner = [false, false, false, false, false, false, false, false];
  const vertX = new Float64Array(12);
  const vertY = new Float64Array(12);
  const vertZ = new Float64Array(12);
  const inside = (x: number, y: number, z: number) => (
    x >= 0 && y >= 0 && z >= 0 && x < dims[0] && y < dims[1] && z < dims[2] && labels[x + y * dx + z * plane] === classId
  );

  for (let z = z0 - 1; z <= z1; z += 1) {
    for (let y = y0 - 1; y <= y1; y += 1) {
      for (let x = x0 - 1; x <= x1; x += 1) {
        let cube = 0;
        for (let cornerIndex = 0; cornerIndex < 8; cornerIndex += 1) {
          const offset = CORNER_OFFSETS[cornerIndex]!;
          const on = inside(x + offset[0], y + offset[1], z + offset[2]);
          corner[cornerIndex] = on;
          if (on) cube |= 1 << cornerIndex;
        }
        const edges = EDGE_TABLE[cube] ?? 0;
        if (edges === 0) continue;
        for (let edge = 0; edge < 12; edge += 1) {
          if ((edges & (1 << edge)) === 0) continue;
          const pair = EDGES[edge]!;
          const a = CORNER_OFFSETS[pair[0]]!;
          const b = CORNER_OFFSETS[pair[1]]!;
          vertX[edge] = (x + (a[0] + b[0]) * 0.5) * spacing[0];
          vertY[edge] = (y + (a[1] + b[1]) * 0.5) * spacing[1];
          vertZ[edge] = (z + (a[2] + b[2]) * 0.5) * spacing[2];
        }
        const tris = TRI_TABLE[cube]!;
        for (let tri = 0; tri < 16 && tris[tri] !== -1; tri += 3) {
          const i0 = tris[tri]!;
          const i1 = tris[tri + 1]!;
          const i2 = tris[tri + 2]!;
          const e1x = vertX[i1]! - vertX[i0]!;
          const e1y = vertY[i1]! - vertY[i0]!;
          const e1z = vertZ[i1]! - vertZ[i0]!;
          const e2x = vertX[i2]! - vertX[i0]!;
          const e2y = vertY[i2]! - vertY[i0]!;
          const e2z = vertZ[i2]! - vertZ[i0]!;
          const nx = e1y * e2z - e1z * e2y;
          const ny = e1z * e2x - e1x * e2z;
          const nz = e1x * e2y - e1y * e2x;
          positions.push(
            vertX[i0]!, vertY[i0]!, vertZ[i0]!, nx, ny, nz,
            vertX[i1]!, vertY[i1]!, vertZ[i1]!, nx, ny, nz,
            vertX[i2]!, vertY[i2]!, vertZ[i2]!, nx, ny, nz,
          );
        }
      }
    }
  }
  return weld(positions);
}

function weld(interleaved: number[]): RawMesh {
  const groups = new Map<string, { index: number; nx: number; ny: number; nz: number }>();
  const unique: number[] = [];
  const indices: number[] = [];
  for (let cursor = 0; cursor < interleaved.length; cursor += 6) {
    const x = interleaved[cursor]!;
    const y = interleaved[cursor + 1]!;
    const z = interleaved[cursor + 2]!;
    const key = `${Math.round(x * 50)},${Math.round(y * 50)},${Math.round(z * 50)}`;
    let group = groups.get(key);
    if (!group) {
      group = { index: unique.length / 3, nx: 0, ny: 0, nz: 0 };
      groups.set(key, group);
      unique.push(x, y, z);
    }
    group.nx += interleaved[cursor + 3]!;
    group.ny += interleaved[cursor + 4]!;
    group.nz += interleaved[cursor + 5]!;
    indices.push(group.index);
  }
  const normals = new Float32Array(unique.length);
  for (const group of groups.values()) {
    const length = Math.hypot(group.nx, group.ny, group.nz) || 1;
    normals[group.index * 3] = group.nx / length;
    normals[group.index * 3 + 1] = group.ny / length;
    normals[group.index * 3 + 2] = group.nz / length;
  }
  const positions = new Float32Array(indices.length * 3);
  const outNormals = new Float32Array(indices.length * 3);
  for (let index = 0; index < indices.length; index += 1) {
    const vertex = indices[index]! * 3;
    const dest = index * 3;
    positions[dest] = unique[vertex]!;
    positions[dest + 1] = unique[vertex + 1]!;
    positions[dest + 2] = unique[vertex + 2]!;
    outNormals[dest] = normals[vertex]!;
    outNormals[dest + 1] = normals[vertex + 1]!;
    outNormals[dest + 2] = normals[vertex + 2]!;
  }
  return { positions, normals: outNormals };
}
