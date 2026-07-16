import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

// Best-effort auto-detection of Torchlight Infinite's UE_game.log, so a
// streamer doesn't have to hand-find and set TORCHLIGHT_LOG_PATH themselves.
// NOT verified against a real install (no Steam/Epic copy of the game was
// available while writing this) -- it's built from generic, well-documented
// Steam/Epic/Unreal-Engine conventions. TORCHLIGHT_LOG_PATH always wins over
// auto-detection, so a wrong guess here never blocks a manual override.

const LOG_FILE_NAME = 'UE_game.log';
const GAME_DIR_HINT = /torchlight/i;
// Proton's compatdata layout alone is 7 levels deep (<appid>/pfx/drive_c/users/
// steamuser/AppData/Local/<Game>) before even reaching the game's own install
// dir, so this needs real headroom -- these roots are narrow (steamapps/
// common, compatdata, a handful of launcher dirs), not a whole-disk crawl, so
// a deeper budget here is cheap.
const MAX_SEARCH_DEPTH = 10;

function candidateRoots(): string[] {
  const home = homedir();
  const env = process.env;
  const roots: (string | undefined)[] = [];

  if (platform() === 'win32') {
    roots.push(
      join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Steam', 'steamapps', 'common'),
      join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Steam', 'steamapps', 'common'),
      join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Epic Games'),
      env.LOCALAPPDATA,
      env.APPDATA,
      join(home, 'Documents')
    );
    for (const steamRoot of [
      join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Steam'),
      join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Steam')
    ]) {
      roots.push(...extraSteamLibraryRoots(steamRoot));
    }
  } else if (platform() === 'darwin') {
    roots.push(
      join(home, 'Library', 'Application Support', 'Steam', 'steamapps', 'common'),
      join(home, 'Library', 'Application Support')
    );
  } else {
    // Linux, incl. Proton compatdata (a Windows-only game run through Proton
    // still writes its Saved/Logs under the Windows-style prefix path).
    roots.push(
      join(home, '.steam', 'steam', 'steamapps', 'common'),
      join(home, '.local', 'share', 'Steam', 'steamapps', 'common'),
      join(home, '.steam', 'steam', 'steamapps', 'compatdata'),
      join(home, '.local', 'share', 'Steam', 'steamapps', 'compatdata')
    );
  }

  return roots.filter((r): r is string => !!r && existsSync(r));
}

/** Parses Steam's libraryfolders.vdf for additional library paths (games
 * installed to a drive other than the one Steam itself is on). Best-effort
 * text scrape -- the vdf format is simple key-value pairs, no real parser
 * needed for just the "path" fields. */
function extraSteamLibraryRoots(steamRoot: string): string[] {
  const vdfPath = join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  if (!existsSync(vdfPath)) return [];
  try {
    const text = readFileSync(vdfPath, 'utf8');
    const paths = [...text.matchAll(/"path"\s*"([^"]+)"/g)].map((m) => m[1]?.replace(/\\\\/g, '\\'));
    return paths.filter((p): p is string => !!p).map((p) => join(p, 'steamapps', 'common'));
  } catch {
    return [];
  }
}

/** Bounded-depth walk from `root` for a `Saved/Logs/UE_game.log` under any
 * directory whose name mentions "torchlight". Stops descending once it's
 * found the game folder rather than walking the whole tree. Exported
 * (rather than only used via findGameLogPath) so tests can exercise the
 * actual search logic against a synthetic directory tree -- the real
 * Steam/Epic candidate roots aren't something a test sandbox has. */
export function searchRoot(root: string, depth = 0): string[] {
  if (depth > MAX_SEARCH_DEPTH) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;

    if (GAME_DIR_HINT.test(entry)) {
      found.push(...findLogUnder(full));
    } else {
      found.push(...searchRoot(full, depth + 1));
    }
  }
  return found;
}

/** Once inside a torchlight-named install dir, look for Saved/Logs/UE_game.log
 * at a few plausible nesting depths (Proton prefixes add
 * pfx/drive_c/users/steamuser/AppData/Local/<Game>/ in front of it). */
function findLogUnder(installDir: string): string[] {
  const found: string[] = [];
  const stack = [{ dir: installDir, depth: 0 }];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    const { dir, depth } = next;
    const direct = join(dir, 'Saved', 'Logs', LOG_FILE_NAME);
    if (existsSync(direct)) found.push(direct);
    if (depth >= MAX_SEARCH_DEPTH) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) stack.push({ dir: full, depth: depth + 1 });
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return found;
}

/**
 * Auto-detect Torchlight Infinite's UE_game.log across common Steam/Epic
 * install locations. Returns the most recently modified match, or undefined
 * if none was found (caller should fall back to asking the user to set
 * TORCHLIGHT_LOG_PATH).
 */
export function findGameLogPath(): string | undefined {
  const matches = candidateRoots().flatMap((root) => searchRoot(root));
  if (matches.length === 0) return undefined;
  return matches
    .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.path;
}
