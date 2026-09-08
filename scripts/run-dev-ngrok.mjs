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

console.log(`api dev:ngrok → ${publicUrl}`);

const child = spawn("npx", ["nest", "start", "--watch"], {
  cwd: apiRoot,
  shell: true,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "development",
    CORS_ORIGIN: publicUrl,
    PUBLIC_WEB_URL: publicUrl,
    COOKIE_SECURE: "true",
    COOKIE_SAMESITE: "lax",
    GOOGLE_CALLBACK_URL: `${publicUrl}/api/auth/google/callback`,
    NGROK_DOMAIN: domain,
    NGROK_PUBLIC_URL: publicUrl,
  },
});

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
