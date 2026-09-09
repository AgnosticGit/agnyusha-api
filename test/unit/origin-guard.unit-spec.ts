import type { NextFunction, Request, Response } from 'express';
import { createOriginGuard } from '../../src/common/origin.guard';

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
}

describe('createOriginGuard', () => {
  const guard = createOriginGuard(['https://shop.test', ' https://admin.test ']);
  let next: NextFunction;

  beforeEach(() => {
    next = jest.fn();
  });

  it('lets GET/HEAD/OPTIONS through', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const res = mockRes();
      guard({ method, headers: {} } as Request, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      (next as jest.Mock).mockClear();
    }
  });

  it('allows matching Origin', () => {
    const res = mockRes();
    guard(
      {
        method: 'POST',
        headers: { origin: 'https://shop.test' },
      } as Request,
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects disallowed Origin with 403', () => {
    const res = mockRes();
    guard(
      {
        method: 'POST',
        headers: { origin: 'https://evil.test' },
      } as Request,
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 403,
      message: 'Forbidden origin',
    });
  });

  it('continues when Origin/Referer are missing', () => {
    const res = mockRes();
    guard({ method: 'POST', headers: {} } as Request, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('falls back to Referer origin', () => {
    const resOk = mockRes();
    guard(
      {
        method: 'PUT',
        headers: { referer: 'https://admin.test/path?x=1' },
      } as Request,
      resOk,
      next,
    );
    expect(next).toHaveBeenCalled();

    (next as jest.Mock).mockClear();
    const resBad = mockRes();
    guard(
      {
        method: 'PUT',
        headers: { referer: 'https://evil.test/path' },
      } as Request,
      resBad,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(resBad.status).toHaveBeenCalledWith(403);
  });

  it('ignores invalid Referer URLs', () => {
    const res = mockRes();
    guard(
      {
        method: 'POST',
        headers: { referer: 'not-a-url' },
      } as Request,
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});
