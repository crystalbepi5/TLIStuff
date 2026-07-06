import { existsSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';

export interface LogTailerHandle {
  stop(): void;
}

/**
 * Polling-based tail -f, not fs.watch — deliberately, since fs.watch's change-event semantics
 * are notoriously inconsistent across platforms/filesystems (double-fires, misses rapid
 * successive writes), while polling file size on an interval is simple and predictable.
 * Starts from the file's *current* size (tails from "now"), not from byte 0 — a real game
 * log can be large, and re-processing an entire session's history on every app restart would
 * both be wasteful and re-emit old loot as if it just happened.
 */
export function tailLogFile(filePath: string, onLine: (line: string) => void, pollIntervalMs = 500): LogTailerHandle {
  let lastSize = existsSync(filePath) ? statSync(filePath).size : 0;
  let carry = '';
  let stopped = false;
  let polling = false;

  async function poll(): Promise<void> {
    if (stopped || polling) return;
    if (!existsSync(filePath)) return;
    polling = true;
    try {
      const stats = statSync(filePath);
      if (stats.size < lastSize) {
        // Log rotated or truncated (e.g. a new game session) — restart from the beginning.
        lastSize = 0;
        carry = '';
      }
      if (stats.size > lastSize) {
        const length = stats.size - lastSize;
        const handle = await open(filePath, 'r');
        try {
          const { buffer } = await handle.read(Buffer.alloc(length), 0, length, lastSize);
          lastSize = stats.size;
          carry += buffer.toString('utf8');
          const lines = carry.split('\n');
          carry = lines.pop() ?? '';
          for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, '');
            if (line) onLine(line);
          }
        } finally {
          await handle.close();
        }
      }
    } finally {
      polling = false;
    }
  }

  const interval = setInterval(() => { void poll(); }, pollIntervalMs);

  return {
    stop(): void {
      stopped = true;
      clearInterval(interval);
    }
  };
}
