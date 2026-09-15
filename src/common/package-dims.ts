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
 * Collapse order lines into one outer carton for carriers.
 * Keeps catalog axes: max length/width, stacked height × qty.
 */
export function combinePackageDims(lines: PackageLine[]): PackageDimsCm & {
  weightGrams: number;
} {
  let weightGrams = 0;
  let heightCm = 0;
  let lengthCm = 1;
  let widthCm = 1;

  for (const line of lines) {
    const qty = Math.max(1, Math.floor(line.qty) || 1);
    weightGrams += Math.max(1, line.weightGrams) * qty;
    lengthCm = Math.max(lengthCm, Math.max(1, Math.round(line.lengthCm) || 1));
    widthCm = Math.max(widthCm, Math.max(1, Math.round(line.widthCm) || 1));
    heightCm += Math.max(1, Math.round(line.heightCm) || 1) * qty;
  }

  return {
    lengthCm,
    widthCm,
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
