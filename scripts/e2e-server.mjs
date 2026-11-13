// Starts the dashboard for Playwright from a clean data directory.
// Cleanup happens here, before the database is opened, so no file handle blocks it.
import { rmSync } from 'node:fs';

const dataDir = 'D:/Projects/Tidehaven/data/e2e';
try {
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (error) {
  console.warn(`e2e: could not clear ${dataDir}: ${error.message}`);
}

process.env.TIDEHAVEN_FIXTURE = '1';
process.env.TIDEHAVEN_DATA_DIR = dataDir;
process.env.TIDEHAVEN_PORT = '4519';
process.env.TIDEHAVEN_LOG_LEVEL = 'warn';
process.env.TIDEHAVEN_MIN_FREE_MB = '10';

await import('../dist/main.js');
