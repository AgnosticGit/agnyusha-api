export type PackageDimsCm = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type PackageLine = PackageDimsCm & {
  weightGrams: number;
  qty: number;
};

/**
 * Collapse order lines into one outer carton for carriers:
 * - length/width = max across items (sorted descending faces)
 * - height = sum of heights × qty (stacked)
 */
export function combinePackageDims(lines: PackageLine[]): PackageDimsCm & {
  weightGrams: number;
} {
  let weightGrams = 0;
  let heightCm = 0;
  let maxA = 1;
  let maxB = 1;

  for (const line of lines) {
    const qty = Math.max(1, Math.floor(line.qty) || 1);
    weightGrams += Math.max(1, line.weightGrams) * qty;
    const faces = [line.lengthCm, line.widthCm, line.heightCm]
      .map((n) => Math.max(1, Math.round(n) || 1))
      .sort((a, b) => b - a);
    maxA = Math.max(maxA, faces[0]);
    maxB = Math.max(maxB, faces[1]);
    heightCm += faces[2] * qty;
  }

  return {
    lengthCm: maxA,
    widthCm: maxB,
    heightCm: Math.max(1, heightCm),
    weightGrams: Math.max(1, weightGrams),
  };
}

export function dimsToMm(dims: PackageDimsCm): {
  length_mm: number;
  width_mm: number;
  height_mm: number;
} {
  return {
    length_mm: Math.max(1, Math.round(dims.lengthCm * 10)),
    width_mm: Math.max(1, Math.round(dims.widthCm * 10)),
    height_mm: Math.max(1, Math.round(dims.heightCm * 10)),
  };
}
