// Copies non-TypeScript runtime assets into dist/ so the built CLI can find them.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsSrc = join(root, 'src', 'storage', 'migrations');
const migrationsDest = join(root, 'dist', 'storage', 'migrations');
if (!existsSync(migrationsSrc)) {
  console.error('migrations directory missing:', migrationsSrc);
  process.exit(1);
}
mkdirSync(migrationsDest, { recursive: true });
cpSync(migrationsSrc, migrationsDest, { recursive: true });
console.log(`copied migrations -> ${migrationsDest}`);
