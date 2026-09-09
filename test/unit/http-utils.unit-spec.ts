import {
  readErrorBody,
  sanitizeSearchName,
  withTimeout,
} from '../../src/common/http-utils';

describe('http-utils', () => {
  describe('sanitizeSearchName', () => {
    it('strips control characters, trims, and applies maxLen', () => {
      expect(sanitizeSearchName('  hello\u0000\u0007world\u007F  ')).toBe(
        'helloworld',
      );
      expect(sanitizeSearchName('abcdefghij', 5)).toBe('abcde');
    });

    it('normalizes with NFKC', () => {
      // ﬁ (U+FB01) → fi under NFKC
      expect(sanitizeSearchName('\uFB01sh')).toBe('fish');
    });
  });

  describe('withTimeout', () => {
    it('resolves when the promise finishes in time', async () => {
      await expect(
        withTimeout(Promise.resolve(42), 1000, 'probe'),
      ).resolves.toBe(42);
    });

    it('rejects when the promise exceeds the timeout', async () => {
      jest.useFakeTimers();
      const slow = new Promise<number>((resolve) => {
        setTimeout(() => resolve(1), 5000);
      });
      const pending = withTimeout(slow, 100, 'probe');
      const assertion = expect(pending).rejects.toThrow(
        'probe: timeout after 100ms',
      );
      await jest.advanceTimersByTimeAsync(100);
      await assertion;
      jest.useRealTimers();
    });
  });

  describe('readErrorBody', () => {
    it('returns truncated response text', async () => {
      const res = {
        text: jest.fn().mockResolvedValue('x'.repeat(500)),
      } as unknown as Response;
      await expect(readErrorBody(res, 10)).resolves.toBe('x'.repeat(10));
    });

    it('returns empty string when text() fails', async () => {
      const res = {
        text: jest.fn().mockRejectedValue(new Error('gone')),
      } as unknown as Response;
      await expect(readErrorBody(res)).resolves.toBe('');
    });
  });
});
