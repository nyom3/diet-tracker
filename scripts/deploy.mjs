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
run('npx', ['clasp', 'push']);
run('npx', ['clasp', 'deploy', '--deploymentId', deploymentId]);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
