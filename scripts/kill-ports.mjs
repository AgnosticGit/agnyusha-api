import { execFileSync } from "node:child_process";

const DEFAULT_PORTS = [3000, 3001, 4040];

const ports = process.argv
  .slice(2)
  .map((v) => Number(v))
  .filter((n) => Number.isInteger(n) && n > 0);
const targets = ports.length ? ports : DEFAULT_PORTS;

function pidsOnPortWin(port) {
  const out = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
    ],
    { encoding: "utf8" },
  );
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

function pidsOnPortUnix(port) {
  try {
    const out = execFileSync("lsof", ["-ti", `:${port}`], {
      encoding: "utf8",
    });
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

function killPid(pid) {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    process.kill(pid, "SIGKILL");
  }
}

const pidsOnPort =
  process.platform === "win32" ? pidsOnPortWin : pidsOnPortUnix;

const killed = new Set();
for (const port of targets) {
  let pids = [];
  try {
    pids = pidsOnPort(port);
  } catch {
    pids = [];
  }
  if (!pids.length) {
    console.log(`:${port} free`);
    continue;
  }
  for (const pid of pids) {
    if (killed.has(pid)) continue;
    try {
      killPid(pid);
      killed.add(pid);
      console.log(`:${port} killed pid ${pid}`);
    } catch (err) {
      console.error(
        `:${port} failed to kill pid ${pid}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
