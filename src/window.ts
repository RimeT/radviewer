export interface WindowLevel {
  center: number;
  width: number;
}

export const CT_PRESETS = {
  soft: { center: 40, width: 400 },
  lung: { center: -600, width: 1500 },
  bone: { center: 400, width: 1800 },
} as const;

/** Percentile window from a strided sample, stable for both CT and MR. */
export function autoWindow(values: ArrayLike<number>): WindowLevel {
  const stride = Math.max(1, Math.floor(values.length / 120_000));
  const samples: number[] = [];
  for (let index = 0; index < values.length; index += stride) {
    const value = values[index]!;
    if (Number.isFinite(value)) samples.push(value);
  }
  if (samples.length === 0) return { center: 0, width: 1 };
  samples.sort((a, b) => a - b);
  const pick = (percentile: number) => samples[Math.min(samples.length - 1, Math.max(0, Math.round((samples.length - 1) * percentile)))]!;
  const low = pick(0.01);
  const high = pick(0.99);
  return { center: (high + low) / 2, width: Math.max(1, high - low) };
}
