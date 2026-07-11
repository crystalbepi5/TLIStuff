// Copies the canonical seed JSON into dist/ after tsc, so the compiled
// dataset.js can resolve its `import ... with { type: 'json' }` at runtime.
// Cross-platform (fs.cpSync), no shell dependency.
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/seed', import.meta.url));
const dest = fileURLToPath(new URL('../dist/seed', import.meta.url));
cpSync(src, dest, { recursive: true });
