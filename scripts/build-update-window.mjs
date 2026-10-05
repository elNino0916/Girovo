// Builds the window shown while an update installs
// (build/update-window/UpdateWindow.cs → build/update-window/bin/Girovo-Update.exe),
// with the C# compiler every Windows has: .NET Framework 4.x and its WPF, so
// nothing to install and nothing extra to ship. electron-builder.yml takes the
// result into the app's resources.
//
// Usage:
//   node scripts/build-update-window.mjs                  build it
//   node scripts/build-update-window.mjs --demo light     build it and show it (light, dark, failure)

import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'build', 'update-window', 'UpdateWindow.cs');
const OUT_DIR = path.join(ROOT, 'build', 'update-window', 'bin');
export const UPDATE_WINDOW_EXE = path.join(OUT_DIR, 'Girovo-Update.exe');

export function buildUpdateWindow() {
  const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const csc = path.join(framework, 'csc.exe');
  if (process.platform !== 'win32' || !fs.existsSync(csc)) {
    // The app works without it: an update then installs without a window.
    console.warn('! no C# compiler (.NET Framework 4.x) here: the update window is left out');
    fs.rmSync(UPDATE_WINDOW_EXE, { force: true });
    return false;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const args = [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/warnaserror+',
    '/nowarn:1607',
    `/out:${UPDATE_WINDOW_EXE}`,
    `/lib:${path.join(framework, 'WPF')}`,
    '/r:PresentationFramework.dll',
    '/r:PresentationCore.dll',
    '/r:WindowsBase.dll',
    '/r:System.Xaml.dll',
    `/resource:${path.join(ROOT, 'build', 'icon.png')},icon.png`,
    SOURCE,
  ];
  const result = spawnSync(csc, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('✗ the update window did not compile');
    process.exit(result.status ?? 1);
  }
  console.log(`✓ update window built (${fs.statSync(UPDATE_WINDOW_EXE).size} bytes)`);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = buildUpdateWindow();
  const demo = process.argv.indexOf('--demo');
  if (built && demo !== -1) {
    const look = process.argv[demo + 1] || 'light';
    spawn(UPDATE_WINDOW_EXE, [
      '--demo', look === 'failure' ? 'failure' : 'progress',
      '--theme', look === 'dark' ? 'dark' : 'light',
      '--version', '4.1.4',
      '--app-exe', 'C:\\Program Files\\Girovo\\Girovo.exe',
    ], { detached: true, stdio: 'ignore' }).unref();
  }
}
