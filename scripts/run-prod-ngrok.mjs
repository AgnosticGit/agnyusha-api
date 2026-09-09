import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(root, "..");
const candidates = [
  join(apiRoot, "..", "agnyusha-web", "tunnel.config.json"),
  join(apiRoot, "tunnel.config.json"),
];
const configPath = candidates.find((p) => existsSync(p));
if (!configPath) {
  console.error(
    "tunnel.config.json not found (expected in agnyusha-web). Set NGROK_DOMAIN.",
  );
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const domain = String(
  process.env.NGROK_DOMAIN || config.domain || "",
).replace(/^https?:\/\//, "");
if (!domain) {
  console.error("Missing ngrok domain");
  process.exit(1);
}

const publicUrl = `https://${domain}`;

/** Parse KEY=VALUE lines; later used to beat IDE-injected .env (edu) pollution. */
function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const productionFileEnv = parseEnvFile(join(apiRoot, ".env.production"));

console.log(`api prod:ngrok → build + start @ ${publicUrl}`);
if (productionFileEnv.CDEK_API_URL) {
  console.log(
    `CDEK from .env.production: ${productionFileEnv.CDEK_API_URL} · ${productionFileEnv.CDEK_FROM_LOCATION || "(no FROM)"}`,
  );
}

const env = {
  ...process.env,
  ...productionFileEnv,
  NODE_ENV: "production",
  CORS_ORIGIN: publicUrl,
  PUBLIC_WEB_URL: publicUrl,
  COOKIE_SECURE: "true",
  COOKIE_SAMESITE: "lax",
  GOOGLE_CALLBACK_URL: `${publicUrl}/api/auth/google/callback`,
  NGROK_DOMAIN: domain,
  NGROK_PUBLIC_URL: publicUrl,
};

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: apiRoot,
      shell: true,
      stdio: "inherit",
      env,
    });
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code ?? signal}`));
    });
  });
}

try {
  await run("npx", ["nest", "build"]);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const child = spawn("node", ["dist/src/main.js"], {
  cwd: apiRoot,
  shell: true,
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
