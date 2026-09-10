import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve reserved ngrok domain from env or agnyusha-web/tunnel.config.json.
 * Shared by api `dev:ngrok` / `prod:ngrok` scripts.
 */
export function resolveNgrokPublicUrl(apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..")) {
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
  return { domain, publicUrl: `https://${domain}`, apiRoot };
}

/** Parse KEY=VALUE dotenv file into a plain object (empty if missing). */
export function parseEnvFile(filePath) {
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

/** Cookie/CORS/Google overrides shared by ngrok API launches. */
export function ngrokRuntimeOverrides(publicUrl) {
  return {
    CORS_ORIGIN: publicUrl,
    PUBLIC_WEB_URL: publicUrl,
    COOKIE_SECURE: "true",
    COOKIE_SAMESITE: "lax",
    GOOGLE_CALLBACK_URL: `${publicUrl}/api/auth/google/callback`,
    NGROK_DOMAIN: publicUrl.replace(/^https?:\/\//, ""),
    NGROK_PUBLIC_URL: publicUrl,
  };
}
