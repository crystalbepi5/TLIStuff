import { app, BrowserWindow, globalShortcut } from 'electron';
import { join } from 'node:path';

const isDev = process.env.NODE_ENV !== 'production';
const devServerUrl = process.env.TORCHLIGHT_COMPANION_WEB_URL ?? 'http://127.0.0.1:5174';
const TOGGLE_HOTKEY = 'CommandOrControl+Shift+O';

let interactive = false;

function setInteractive(win: BrowserWindow, next: boolean): void {
  interactive = next;
  // forward: true keeps hover states working while click-through is on (mousemove still
  // reaches the renderer) — validated as the right call for a loot tracker with tooltips,
  // at the cost of some known flicker/perf quirks on certain multi-monitor/mixed-DPI setups.
  win.setIgnoreMouseEvents(!next, { forward: true });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 340,
    height: 480,
    transparent: true,
    frame: false,
    hasShadow: false, // avoids a stray shadow/border artifact on frameless transparent windows
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // 'screen-saver' is the highest always-on-top tier Electron exposes on Windows — plain
  // alwaysOnTop:true sits at the same "normal" topmost tier as other overlay software
  // (Discord, RTSS, etc.) and can get silently knocked behind it.
  win.setAlwaysOnTop(true, 'screen-saver');
  setInteractive(win, false);

  // Documented product limitation, not a bug to chase: true DX exclusive-fullscreen games
  // bypass the DWM compositor entirely, so no overlay window — this one, Discord's, anything —
  // can render on top of that. Only Borderless Windowed mode composites correctly.
  if (isDev) void win.loadURL(devServerUrl);
  else void win.loadFile(join(__dirname, '..', 'web-dist', 'index.html'));

  const registered = globalShortcut.register(TOGGLE_HOTKEY, () => setInteractive(win, !interactive));
  if (!registered) {
    console.warn(`Failed to register ${TOGGLE_HOTKEY} — another application may already own this hotkey.`);
  }

  // Some games'/overlay software's own windows re-grab the topmost slot; periodically
  // re-assert it rather than fighting that once at startup only.
  const reassertTopmost = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(reassertTopmost);
    win.setAlwaysOnTop(true, 'screen-saver');
  }, 5000);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});
