import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = join(__dirname, '../..');
const script = join(repoRoot, 'scripts/check-deploy-env.mjs');
const scriptUrl = pathToFileURL(script).href;

function runCheck(inline: string) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '-e', inline],
    { cwd: repoRoot, encoding: 'utf8' },
  );
}

const MIN_WORKFLOW = `
          is_secret_key() {
              case "$1" in
                POSTGRES_PASSWORD)
                  return 0 ;;
                *) return 1 ;;
              esac
            }
            upsert_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
            \${{ secrets.POSTGRES_PASSWORD }}
`;

describe('deploy env sync', () => {
  it('keeps root .env.example keys on the VPS template and secret wiring', () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails when a new key is only in the local template', () => {
    const result = runCheck(`
      import { checkDeployEnv } from ${JSON.stringify(scriptUrl)};
      const r = checkDeployEnv({
        rootExample: 'CORS_ORIGIN=http://localhost:3000\\nNEW_FEATURE_FLAG=1\\n',
        deployExample: 'CORS_ORIGIN=https://agnyusha.ru\\nPOSTGRES_PASSWORD=CHANGE_ME\\n',
        workflow: ${JSON.stringify(MIN_WORKFLOW)},
      });
      if (r.ok || !r.errors.some((e) => e.includes('NEW_FEATURE_FLAG'))) process.exit(1);
    `);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
