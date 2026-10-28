import type { Dims, DvrVolume, Vec3 } from './types.ts';

/** Box-filter a volume so its longest edge is at most `maxEdge`. */
export function downsample(values: ArrayLike<number>, dims: Dims, spacing: Vec3, maxEdge = 256): DvrVolume {
  const longest = Math.max(dims[0], dims[1], dims[2]);
  const scale = Math.min(1, maxEdge / longest);
  const outDims: Dims = [
    Math.max(1, Math.round(dims[0] * scale)),
    Math.max(1, Math.round(dims[1] * scale)),
    Math.max(1, Math.round(dims[2] * scale)),
  ];
  const out = new Float32Array(outDims[0] * outDims[1] * outDims[2]);
  const dx = dims[0];
  const dy = dims[1];
  for (let z = 0; z < outDims[2]; z += 1) {
    const z0 = Math.floor((z * dims[2]) / outDims[2]);
    const z1 = Math.max(z0 + 1, Math.floor(((z + 1) * dims[2]) / outDims[2]));
    for (let y = 0; y < outDims[1]; y += 1) {
      const y0 = Math.floor((y * dims[1]) / outDims[1]);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * dims[1]) / outDims[1]));
      for (let x = 0; x < outDims[0]; x += 1) {
        const x0 = Math.floor((x * dims[0]) / outDims[0]);
        const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * dims[0]) / outDims[0]));
        let sum = 0;
        let count = 0;
        for (let zz = z0; zz < z1; zz += 1) {
          for (let yy = y0; yy < y1; yy += 1) {
            let index = x0 + yy * dx + zz * dx * dy;
            for (let xx = x0; xx < x1; xx += 1) {
              sum += values[index]!;
              count += 1;
              index += 1;
            }
          }
        }
        out[x + y * outDims[0] + z * outDims[0] * outDims[1]] = count > 0 ? sum / count : 0;
      }
    }
  }
  return {
    dims: outDims,
    spacing: [
      spacing[0] * (dims[0] / outDims[0]),
      spacing[1] * (dims[1] / outDims[1]),
      spacing[2] * (dims[2] / outDims[2]),
    ],
    values: out,
  };
}
