import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  ngrokRuntimeOverrides,
  parseEnvFile,
  resolveNgrokPublicUrl,
} from "./ngrok-shared.mjs";

const { domain, publicUrl, apiRoot } = resolveNgrokPublicUrl();
const developmentFileEnv = parseEnvFile(join(apiRoot, ".env.development"));

console.log(`api dev:ngrok → ${publicUrl}`);
if (developmentFileEnv.CDEK_API_URL) {
  console.log(
    `CDEK from .env.development: ${developmentFileEnv.CDEK_API_URL} · ${developmentFileEnv.CDEK_FROM_LOCATION || "(no FROM)"}`,
  );
}

const child = spawn("npx", ["nest", "start", "--watch"], {
  cwd: apiRoot,
  shell: true,
  stdio: "inherit",
  env: {
    ...process.env,
    ...developmentFileEnv,
    NODE_ENV: "development",
    ...ngrokRuntimeOverrides(publicUrl),
    NGROK_DOMAIN: domain,
  },
});

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
