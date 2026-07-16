// Copies the built web renderer (apps/web/dist) into apps/desktop/web-dist/ so
// the Electron app's production load path doesn't depend on the monorepo's
// sibling-package layout still existing at runtime -- once packaged by
// electron-builder, apps/desktop ships standalone, so its renderer has to
// travel inside its own directory rather than reaching across to ../../web.
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../web/dist', import.meta.url));
const dest = fileURLToPath(new URL('../web-dist', import.meta.url));

if (!existsSync(src)) {
  console.error(`apps/web/dist not found at ${src} -- run "pnpm --filter @torchlight-companion/web build" first.`);
  process.exit(1);
}
cpSync(src, dest, { recursive: true });
