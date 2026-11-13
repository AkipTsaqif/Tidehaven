// Offline verification gate: typecheck (server + client), lint, production build, tests.
//
// The build runs before the tests because the process-resilience tests launch the compiled server
// (dist/main.js). A source-only checkout has no dist/, so testing first would wait for a server that
// cannot start — and, worse, an existing installation would test stale compiled runtime code.
import { spawnSync } from 'node:child_process';

const steps = [
  ['typecheck (server)', 'npx', ['tsc', '-p', 'tsconfig.json', '--noEmit']],
  ['typecheck (client)', 'npx', ['tsc', '-p', 'client/tsconfig.json']],
  ['lint', 'npx', ['eslint', '.']],
  ['build', 'npm', ['run', 'build']],
  ['tests', 'npx', ['vitest', 'run']],
];

for (const [label, command, args] of steps) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    process.stderr.write(`\nFAILED: ${label}\n`);
    process.exit(1);
  }
}
process.stdout.write('\nverify: all gates passed\n');
