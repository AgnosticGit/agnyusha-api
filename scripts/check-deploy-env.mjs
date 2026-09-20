/**
 * Fail if a new API env key is added to the local template but not to the
 * VPS file (`deploy/.env.example`) or GitHub secret wiring in deploy.yml.
 *
 * Local `.env.production` / root `.env.example` are never copied to the server.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Keys that exist locally but compose/code supplies on VPS (or local-only). */
const LOCAL_ONLY = new Set([
  'DATABASE_URL',
  'NGROK_DOMAIN',
  'NGROK_PUBLIC_URL',
  'INVENTORY_ENABLED',
]);

const INFRA_SECRETS = new Set([
  'GITHUB_TOKEN',
  'GHCR_TOKEN',
  'SSH_HOST',
  'SSH_USER',
  'SSH_KEY',
  'SSH_PORT',
]);

function parseEnvKeys(content) {
  const keys = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    keys.push(trimmed.slice(0, eq).trim());
  }
  return keys;
}

function parseIsSecretKeys(workflow) {
  const block = workflow.match(/is_secret_key\(\)\s*\{([\s\S]*?)\n\s*\}/);
  if (!block) {
    throw new Error('Could not find is_secret_key() in deploy.yml');
  }
  const keys = [...block[1].matchAll(/\b([A-Z][A-Z0-9_]+)\b/g)].map(
    (m) => m[1],
  );
  return [...new Set(keys)].filter((k) => k !== 'CHANGE_ME');
}

function parseUpsertSecretKeys(workflow) {
  const keys = [];
  for (const line of workflow.split(/\r?\n/)) {
    const m = line.trim().match(/^upsert_env ([A-Z][A-Z0-9_]+) "/);
    if (m && m[1] !== 'DEPLOYED_AT') keys.push(m[1]);
  }
  return keys;
}

function parseWorkflowSecretRefs(workflow) {
  return [
    ...new Set(
      [...workflow.matchAll(/secrets\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]),
    ),
  ].filter((k) => !INFRA_SECRETS.has(k));
}

export function checkDeployEnv({
  rootExample,
  deployExample,
  workflow,
} = {}) {
  const errors = [];
  const rootKeys = parseEnvKeys(
    rootExample ?? readFileSync(join(root, '.env.example'), 'utf8'),
  );
  const deployKeys = parseEnvKeys(
    deployExample ?? readFileSync(join(root, 'deploy/.env.example'), 'utf8'),
  );
  const yml =
    workflow ??
    readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');

  const deploySet = new Set(deployKeys);
  const missingOnVps = rootKeys.filter(
    (k) => !LOCAL_ONLY.has(k) && !deploySet.has(k),
  );
  if (missingOnVps.length) {
    errors.push(
      `These keys are in .env.example but not in deploy/.env.example ` +
        `(VPS will never get them): ${missingOnVps.join(', ')}`,
    );
  }

  const secretKeys = parseIsSecretKeys(yml);
  const upsertKeys = parseUpsertSecretKeys(yml);
  const secretRefs = parseWorkflowSecretRefs(yml);
  const secretSet = new Set(secretKeys);

  for (const k of secretRefs) {
    if (!secretSet.has(k)) {
      errors.push(
        `GitHub secret ${k} is used in deploy.yml but missing from is_secret_key()`,
      );
    }
    if (!deploySet.has(k)) {
      errors.push(
        `GitHub secret ${k} has no placeholder in deploy/.env.example`,
      );
    }
    if (!upsertKeys.includes(k)) {
      errors.push(
        `GitHub secret ${k} is not upsert_env'd into /opt/agnyusha/.env`,
      );
    }
  }

  for (const k of secretKeys) {
    if (!secretRefs.includes(k)) {
      errors.push(
        `is_secret_key lists ${k} but deploy.yml has no secrets.${k}`,
      );
    }
  }

  return { ok: errors.length === 0, errors, missingOnVps };
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const result = checkDeployEnv();
  if (!result.ok) {
    console.error(result.errors.join('\n'));
    process.exit(1);
  }
  console.log('deploy/.env.example and GitHub secret wiring are in sync.');
}
