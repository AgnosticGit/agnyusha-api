import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  ngrokRuntimeOverrides,
  parseEnvFile,
  resolveNgrokPublicUrl,
} from "./ngrok-shared.mjs";

const { domain, publicUrl, apiRoot } = resolveNgrokPublicUrl();
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
  ...ngrokRuntimeOverrides(publicUrl),
  NGROK_DOMAIN: domain,
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
