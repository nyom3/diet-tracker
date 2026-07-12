import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('.clasp.json')) {
  console.error('.clasp.json is missing. Copy .clasp.example.json and set scriptId / deploymentId first.');
  process.exit(1);
}

const config = JSON.parse(readFileSync('.clasp.json', 'utf8'));
const deploymentId = String(config.deploymentId || '').trim();

if (!deploymentId || deploymentId === 'YOUR_WEB_APP_DEPLOYMENT_ID') {
  console.error('deploymentId is missing in .clasp.json. Run npm run gas:deploy:new once, then record the deploymentId.');
  process.exit(1);
}

run('npm', ['run', 'build']);
const pushResult = run('npx', ['clasp', 'push'], { captureOutput: true });
if (pushResult.stdout.includes('Skipping push.')) {
  console.error(
    'clasp pushがスキップされました。GASは更新されていません。' +
      'appsscript.jsonの差分を確認してから再実行してください。CIでは--forceを使用しません。',
  );
  process.exit(1);
}
run('npx', ['clasp', 'deploy', '--deploymentId', deploymentId]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: true,
  });

  if (options.captureOutput) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  return result;
}
