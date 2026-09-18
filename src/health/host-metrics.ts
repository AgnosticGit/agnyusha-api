import { readFile, statfs } from 'fs/promises';
import * as os from 'os';
import { join } from 'path';
import type { HealthStatus } from './health.types';

export type HostMetricSource = 'host' | 'container';

export type HostMetricSnapshot = {
  at: string;
  memTotalMb: number;
  memAvailableMb: number;
  memUsedPct: number;
  swapTotalMb: number;
  swapUsedMb: number;
  load1: number;
  diskTotalMb: number;
  diskUsedPct: number;
  source: HostMetricSource;
};

export type HostHealthResult = {
  status: HealthStatus;
  message: string;
};

const KB = 1024;
const MB = 1024 * 1024;

/** Available RAM below this → degraded (MB). */
export const HOST_RAM_AVAILABLE_DEGRADED_MB = 100;
/** Swap used fraction above this → degraded. */
export const HOST_SWAP_USED_DEGRADED = 0.7;
/** Disk used % above this → degraded. */
export const HOST_DISK_DEGRADED_PCT = 90;
/** Disk used % above this → down. */
export const HOST_DISK_DOWN_PCT = 95;

export function parseMeminfoKb(text: string): {
  memTotalKb: number;
  memAvailableKb: number;
  swapTotalKb: number;
  swapFreeKb: number;
} | null {
  const map = new Map<string, number>();
  for (const line of text.split('\n')) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) map.set(m[1], Number(m[2]));
  }
  const memTotalKb = map.get('MemTotal');
  const memAvailableKb = map.get('MemAvailable') ?? map.get('MemFree');
  const swapTotalKb = map.get('SwapTotal') ?? 0;
  const swapFreeKb = map.get('SwapFree') ?? 0;
  if (memTotalKb == null || memAvailableKb == null || memTotalKb <= 0) {
    return null;
  }
  return { memTotalKb, memAvailableKb, swapTotalKb, swapFreeKb };
}

export function parseLoadavg1(text: string): number | null {
  const first = text.trim().split(/\s+/)[0];
  const n = Number(first);
  return Number.isFinite(n) ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function kbToMb(kb: number): number {
  return round1(kb / KB);
}

function bytesToMb(bytes: number): number {
  return round1(bytes / MB);
}

export function buildSnapshotFromParts(input: {
  at?: Date;
  memTotalMb: number;
  memAvailableMb: number;
  swapTotalMb: number;
  swapUsedMb: number;
  load1: number;
  diskTotalMb: number;
  diskUsedPct: number;
  source: HostMetricSource;
}): HostMetricSnapshot {
  const memTotalMb = Math.max(0, input.memTotalMb);
  const memAvailableMb = Math.min(memTotalMb, Math.max(0, input.memAvailableMb));
  const memUsedPct =
    memTotalMb > 0
      ? round1(((memTotalMb - memAvailableMb) / memTotalMb) * 100)
      : 0;
  return {
    at: (input.at ?? new Date()).toISOString(),
    memTotalMb: round1(memTotalMb),
    memAvailableMb: round1(memAvailableMb),
    memUsedPct,
    swapTotalMb: round1(Math.max(0, input.swapTotalMb)),
    swapUsedMb: round1(Math.max(0, input.swapUsedMb)),
    load1: round1(input.load1),
    diskTotalMb: round1(Math.max(0, input.diskTotalMb)),
    diskUsedPct: round1(Math.min(100, Math.max(0, input.diskUsedPct))),
    source: input.source,
  };
}

async function readDisk(rootPath: string): Promise<{
  diskTotalMb: number;
  diskUsedPct: number;
}> {
  const st = await statfs(rootPath);
  const total = Number(st.blocks) * Number(st.bsize);
  const free = Number(st.bavail) * Number(st.bsize);
  const used = Math.max(0, total - free);
  const diskTotalMb = bytesToMb(total);
  const diskUsedPct = total > 0 ? round1((used / total) * 100) : 0;
  return { diskTotalMb, diskUsedPct };
}

async function tryReadProc(
  procPath: string,
): Promise<{
  memTotalMb: number;
  memAvailableMb: number;
  swapTotalMb: number;
  swapUsedMb: number;
  load1: number;
} | null> {
  try {
    const [memText, loadText] = await Promise.all([
      readFile(join(procPath, 'meminfo'), 'utf8'),
      readFile(join(procPath, 'loadavg'), 'utf8'),
    ]);
    const mem = parseMeminfoKb(memText);
    const load1 = parseLoadavg1(loadText);
    if (!mem || load1 == null) return null;
    const swapUsedKb = Math.max(0, mem.swapTotalKb - mem.swapFreeKb);
    return {
      memTotalMb: kbToMb(mem.memTotalKb),
      memAvailableMb: kbToMb(mem.memAvailableKb),
      swapTotalMb: kbToMb(mem.swapTotalKb),
      swapUsedMb: kbToMb(swapUsedKb),
      load1,
    };
  } catch {
    return null;
  }
}

function osFallbackMemory(): {
  memTotalMb: number;
  memAvailableMb: number;
  swapTotalMb: number;
  swapUsedMb: number;
  load1: number;
} {
  const memTotalMb = bytesToMb(os.totalmem());
  const memAvailableMb = bytesToMb(os.freemem());
  const load1 = os.loadavg()[0] ?? 0;
  return {
    memTotalMb,
    memAvailableMb,
    swapTotalMb: 0,
    swapUsedMb: 0,
    load1,
  };
}

/**
 * Collect host/container resource snapshot.
 * Prefers `procPath` (e.g. /host/proc); falls back to /proc, then os.*.
 */
export async function collectHostSnapshot(opts?: {
  procPath?: string;
  rootPath?: string;
  at?: Date;
}): Promise<HostMetricSnapshot> {
  const preferredProc = opts?.procPath?.trim() || '/host/proc';
  const rootPath = opts?.rootPath?.trim() || '/';

  let mem = await tryReadProc(preferredProc);
  let source: HostMetricSource =
    preferredProc !== '/proc' ? 'host' : 'container';

  if (!mem) {
    mem = await tryReadProc('/proc');
    source = 'container';
  }
  if (!mem) {
    mem = osFallbackMemory();
    source = 'container';
  }

  let disk: { diskTotalMb: number; diskUsedPct: number };
  try {
    disk = await readDisk(rootPath);
  } catch {
    try {
      disk = await readDisk('/');
    } catch {
      disk = { diskTotalMb: 0, diskUsedPct: 0 };
    }
  }

  return buildSnapshotFromParts({
    at: opts?.at,
    ...mem,
    ...disk,
    source,
  });
}

export function evaluateHostHealth(
  snapshot: HostMetricSnapshot,
): HostHealthResult {
  const swapFrac =
    snapshot.swapTotalMb > 0
      ? snapshot.swapUsedMb / snapshot.swapTotalMb
      : 0;

  let status: HealthStatus = 'ok';
  if (snapshot.diskUsedPct >= HOST_DISK_DOWN_PCT) status = 'down';
  else if (
    snapshot.diskUsedPct >= HOST_DISK_DEGRADED_PCT ||
    snapshot.memAvailableMb < HOST_RAM_AVAILABLE_DEGRADED_MB ||
    swapFrac >= HOST_SWAP_USED_DEGRADED
  ) {
    status = 'degraded';
  }

  const message =
    `RAM available ${Math.round(snapshot.memAvailableMb)}MB / ${Math.round(snapshot.memTotalMb)}MB` +
    ` · swap ${Math.round(snapshot.swapUsedMb)}MB` +
    ` · load ${snapshot.load1}` +
    ` · disk ${Math.round(snapshot.diskUsedPct)}%` +
    ` · source=${snapshot.source}`;

  return { status, message };
}
