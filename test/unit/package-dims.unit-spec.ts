import {
  combinePackageDims,
  dimsToMm,
  type PackageLine,
} from '../../src/common/package-dims';

describe('package-dims', () => {
  it('combines stacked heights and max footprint', () => {
    const lines: PackageLine[] = [
      { lengthCm: 30, widthCm: 20, heightCm: 10, weightGrams: 500, qty: 2 },
      { lengthCm: 25, widthCm: 15, heightCm: 8, weightGrams: 300, qty: 1 },
    ];
    expect(combinePackageDims(lines)).toEqual({
      lengthCm: 30,
      widthCm: 20,
      heightCm: 28,
      weightGrams: 1300,
    });
  });

  it('keeps catalog axes for a tall 800g pack', () => {
    expect(
      combinePackageDims([
        {
          lengthCm: 15,
          widthCm: 8,
          heightCm: 28,
          weightGrams: 800,
          qty: 1,
        },
      ]),
    ).toEqual({
      lengthCm: 15,
      widthCm: 8,
      heightCm: 28,
      weightGrams: 800,
    });
  });

  it('converts cm to mm', () => {
    expect(dimsToMm({ lengthCm: 20, widthCm: 15, heightCm: 10 })).toEqual({
      length_mm: 200,
      width_mm: 150,
      height_mm: 100,
    });
  });
});
