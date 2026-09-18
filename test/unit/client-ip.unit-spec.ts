import type { Request } from 'express';
import { resolveClientIp } from '../../src/common/client-ip';

function fakeReq(partial: {
  forwarded?: string | string[];
  ip?: string;
  remoteAddress?: string;
}): Request {
  return {
    headers: {
      'x-forwarded-for': partial.forwarded,
    },
    ip: partial.ip,
    socket: { remoteAddress: partial.remoteAddress },
  } as Request;
}

describe('resolveClientIp', () => {
  it('uses first X-Forwarded-For hop', () => {
    expect(
      resolveClientIp(
        fakeReq({ forwarded: ' 1.1.1.1, 2.2.2.2 ', ip: '9.9.9.9' }),
      ),
    ).toBe('1.1.1.1');
  });

  it('falls back to req.ip then socket', () => {
    expect(resolveClientIp(fakeReq({ ip: '8.8.8.8' }))).toBe('8.8.8.8');
    expect(resolveClientIp(fakeReq({ remoteAddress: '7.7.7.7' }))).toBe(
      '7.7.7.7',
    );
    expect(resolveClientIp(fakeReq({}))).toBe('unknown');
  });
});
