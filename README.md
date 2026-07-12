# Torchlight Companion

A desktop overlay and real-time loot tracker for the ARPG **Torchlight Infinite** — a transparent, click-through window that sits on top of the game and shows recent pickups, running net worth, and current-run stats as they happen.

Architected to mirror the conventions of a separate ChaOS Forge IDE project: a pnpm workspace monorepo, `node:sqlite` for persistence (zero native compilation), a plain `node:http` backend with no framework, and an Electron shell wrapping a Vite + React UI.

## What it does (v1)

- **Loot tracking**: tails the game's own `UE_game.log` file, infers pickups by diffing inventory-slot state, and persists them locally. No memory reading, no process hooking, no injection — purely reading a log file the game already writes for its own diagnostics.
- **Overlay**: a transparent, always-on-top, click-through window layered over the game. A global hotkey toggles it into an interactive mode (for scrolling/settings) and back.
- **Real-time updates**: the overlay UI updates via Server-Sent Events as new loot is parsed — no polling.

## What it explicitly does *not* do yet

One originally-considered feature is deferred to a later phase, on purpose:

- **Loot filter modifier** — Torchlight Infinite's filters are account-bound and shared via opaque "filter codes," not a local editable file (unlike Path of Exile's `.filter` format). The exact code format isn't publicly documented.

## Build planner (new)

The **build helper** — originally deferred for lack of a public item/affix/skill dataset — now ships as a working, if approximate, feature:

- **`packages/build-data`** — a typed schema (heroes, active/support skills, affixes, gear bases, talents, pact spirits, Nether King's Divinity nodes, saved builds) plus a *seed* dataset curated by hand from the SS13 "Afterlight" patch notes: the Terra skills (Tidewell, Thornfield, Storm Field, Dance of the Deep), their supports, Icemirror, and real Nether King's Divinity nodes.
- **`packages/build-calc`** — a pure, fully-tested modifier engine implementing the standard ARPG damage pipeline (base → added flat → sum of *increased%* → product of *more%* → crit → rate) plus life/ES/resist/EHP defence.
- **`apps/web`** — a **Build Planner** view: pick a hero, main skill, supports, gear, and **progression** (talent-tree nodes, Pact Spirits, and Nether King's Divinity), and see DPS / crit / rate / per-element damage and defence recompute live. Reachable at the `#planner` URL hash (a normal opaque page, separate from the transparent overlay). Builds export/import as a base64 share code.

### Honest caveats

- **Real data, simplified model.** The seed names and values are taken from the official SS13 patch notes, but mapped onto a deliberately simple calculator: effects that depend on unmodelled mechanics (Terra Charge stacks, Spell Burst, Bond, shotgun falloff, conditionals) are approximated to the nearest modelled stat or dropped — see each seed file's note. The damage *formula* is still an estimate (TLI doesn't publish it), so treat DPS as a *relative* indicator, not in-game truth. This is surfaced in the UI and flagged throughout the source.
- **`packages/build-scraper`** is the intended path to real, complete data: it pulls the `__NEXT_DATA__` JSON that community databases (tli-hub.com, tlidb.com) embed and emits the `build-data` `Dataset` shape. Its site-agnostic core (fetch, extraction, assembly, validation) is tested; the site-specific field mapping is explicitly marked as needing verification against the live payload. **It must be run on your own machine** — the hosts it targets are unreachable from the web-based dev sandbox this was built in.

## Known limitation: the log parser is a best guess

`packages/log-parser`'s `parseInventorySlotLine` and `parseExchangeSearchPriceLine` were written **without a real sample of `UE_game.log`** — they're modeled on how the open-source tool [TITrack](https://github.com/astockman99/TITrack) is publicly described to work (`PageId`/`SlotId`/`ConfigBaseId`/`Count` key-value tokens, `XchgSearchPrice` marketplace events), not verified against real log output. This is clearly flagged in the source. Everything else — the generic Unreal Engine log-line tokenizer, the inventory-diffing logic, the SQLite/HTTP/SSE/UI pipeline — is real, tested, and doesn't depend on that guess being right.

If you're picking this up: get a real `UE_game.log` sample (enable logging in-game, play a few minutes) and correct those two functions against it before trusting loot tracking in production.

## Project layout

```
packages/domain       — shared TypeScript types (LootEvent, MapRun, PriceEntry, ...)
packages/db           — node:sqlite persistence layer
packages/log-parser   — pure functions: log-line parsing + inventory-snapshot diffing
packages/build-data   — build planner schema + seed dataset (heroes, skills, affixes, gear)
packages/build-calc   — pure DPS / EHP modifier engine
packages/build-scraper— community-DB ingestion into the build-data Dataset shape (run locally)
apps/local-agent      — plain node:http backend: log tailer, snapshot + SSE endpoints
apps/web              — Vite + React UI: transparent overlay (default) + build planner (#planner)
apps/desktop          — Electron shell (transparent, click-through, always-on-top)
```

## Setup

Requires Node.js (v24.x) and pnpm (pinned via `packageManager` in `package.json`).

```powershell
pnpm install
pnpm build
```

Copy `.env.example` to `.env` and set `TORCHLIGHT_LOG_PATH` to your real `UE_game.log` location (typically under `...\Torchlight Infinite\UE_game\TorchLight\Saved\Logs\` — you'll need to enable logging in-game first).

## Running it

Three terminals, same pattern as most local-first Electron apps in this style:

```powershell
# terminal 1 — backend (log tailer + API)
cd apps\local-agent
node dist\index.js

# terminal 2 — web UI in dev mode (only needed while developing)
cd apps\web
pnpm dev

# terminal 3 — the overlay window itself
cd apps\desktop
pnpm dev
```

Default hotkey to toggle the overlay between click-through and interactive mode: **Ctrl+Shift+O**.

**Note:** the overlay only renders on top of games running in **Borderless Windowed** mode. True exclusive fullscreen bypasses the compositor entirely, so no overlay software (this one, Discord's, anything) can draw over it.

## Testing

```powershell
pnpm test        # all packages
pnpm typecheck
```

`apps/local-agent`'s test suite genuinely spawns a real file-tailing process and opens a real SSE connection — it's not mocked.
