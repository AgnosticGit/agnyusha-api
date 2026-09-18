import {
  buildSnapshotFromParts,
  evaluateHostHealth,
  parseLoadavg1,
  parseMeminfoKb,
  HOST_DISK_DOWN_PCT,
  HOST_RAM_AVAILABLE_DEGRADED_MB,
} from '../../src/health/host-metrics';

describe('host-metrics parsers', () => {
  it('parses meminfo kb fields', () => {
    const text = `
MemTotal:        978944 kB
MemFree:          32768 kB
MemAvailable:    430080 kB
SwapTotal:      2097148 kB
SwapFree:       1887436 kB
`.trim();
    expect(parseMeminfoKb(text)).toEqual({
      memTotalKb: 978944,
      memAvailableKb: 430080,
      swapTotalKb: 2097148,
      swapFreeKb: 1887436,
    });
  });

  it('falls back to MemFree when MemAvailable missing', () => {
    const text = `
MemTotal:        100000 kB
MemFree:          20000 kB
SwapTotal:            0 kB
SwapFree:             0 kB
`.trim();
    expect(parseMeminfoKb(text)?.memAvailableKb).toBe(20000);
  });

  it('returns null for invalid meminfo', () => {
    expect(parseMeminfoKb('nope')).toBeNull();
  });

  it('parses loadavg first field', () => {
    expect(parseLoadavg1('0.42 0.35 0.30 1/234 99')).toBe(0.42);
    expect(parseLoadavg1('bad')).toBeNull();
  });
});

describe('evaluateHostHealth', () => {
  const base = buildSnapshotFromParts({
    memTotalMb: 956,
    memAvailableMb: 400,
    swapTotalMb: 2048,
    swapUsedMb: 100,
    load1: 0.2,
    diskTotalMb: 8000,
    diskUsedPct: 60,
    source: 'host',
  });

  it('is ok when resources are healthy', () => {
    const r = evaluateHostHealth(base);
    expect(r.status).toBe('ok');
    expect(r.message).toContain('source=host');
    expect(r.message).toContain('RAM available');
  });

  it('degrades when available RAM is low', () => {
    const r = evaluateHostHealth({
      ...base,
      memAvailableMb: HOST_RAM_AVAILABLE_DEGRADED_MB - 1,
    });
    expect(r.status).toBe('degraded');
  });

  it('degrades when swap usage is high', () => {
    const r = evaluateHostHealth({
      ...base,
      swapTotalMb: 1000,
      swapUsedMb: 800,
    });
    expect(r.status).toBe('degraded');
  });

  it('is down when disk is critically full', () => {
    const r = evaluateHostHealth({
      ...base,
      diskUsedPct: HOST_DISK_DOWN_PCT,
    });
    expect(r.status).toBe('down');
  });
});
