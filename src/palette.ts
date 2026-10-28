/** Distinct class colors. Index 0 is unused background. */
export const CLASS_COLORS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [61, 255, 154],
  [76, 195, 255],
  [255, 90, 209],
  [255, 176, 32],
  [124, 107, 255],
  [255, 92, 92],
  [120, 255, 214],
  [255, 214, 102],
  [92, 214, 255],
  [255, 140, 92],
  [186, 140, 255],
  [210, 255, 92],
  [255, 92, 160],
  [92, 140, 255],
  [255, 230, 180],
];

export function classColor(classId: number): [number, number, number] {
  const palette = CLASS_COLORS;
  return palette[((classId - 1) % (palette.length - 1)) + 1] as [number, number, number];
}

export function classCss(classId: number): string {
  const [r, g, b] = classColor(classId);
  return `rgb(${r} ${g} ${b})`;
}
