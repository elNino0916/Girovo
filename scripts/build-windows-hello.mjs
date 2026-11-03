// Builds Windows Hello's helper for the desktop shell
// (build/windows-hello/WindowsHello.cs → build/windows-hello/bin/Girovo-Hello.exe),
// with the C# compiler every Windows has (.NET Framework 4.x) against Windows'
// own API descriptions in System32\WinMetadata: nothing to install and nothing
// extra to ship. electron-builder.yml takes the result into the app's
// resources; `npm run electron:dev` builds it for the dev window
// (electron/main.cjs looks for it here).
//
// Usage:
//   node scripts/build-windows-hello.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'build', 'windows-hello', 'WindowsHello.cs');
const OUT_DIR = path.join(ROOT, 'build', 'windows-hello', 'bin');
export const WINDOWS_HELLO_EXE = path.join(OUT_DIR, 'Girovo-Hello.exe');

export function buildWindowsHello() {
  const windows = process.env.WINDIR || 'C:\\Windows';
  const framework = path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const csc = path.join(framework, 'csc.exe');
  const metadata = path.join(windows, 'System32', 'WinMetadata');
  if (process.platform !== 'win32' || !fs.existsSync(csc) || !fs.existsSync(metadata)) {
    // The app works without it: Windows Hello is then simply not offered.
    console.warn('! no C# compiler (.NET Framework 4.x) or Windows metadata here: Windows Hello is left out');
    fs.rmSync(WINDOWS_HELLO_EXE, { force: true });
    return false;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const args = [
    '/nologo',
    // No console window, even for a moment; stdin and stdout are pipes.
    '/target:winexe',
    '/optimize+',
    '/warnaserror+',
    // The .winmd files name System.Runtime 4.0.0.0, the facade here is newer.
    '/nowarn:1701',
    `/out:${WINDOWS_HELLO_EXE}`,
    `/r:${path.join(framework, 'System.Runtime.dll')}`,
    '/r:System.Runtime.Serialization.dll',
    `/r:${path.join(metadata, 'Windows.Foundation.winmd')}`,
    `/r:${path.join(metadata, 'Windows.Security.winmd')}`,
    `/r:${path.join(metadata, 'Windows.Storage.winmd')}`,
    SOURCE,
  ];
  const result = spawnSync(csc, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('✗ the Windows Hello helper did not compile');
    process.exit(result.status ?? 1);
  }
  console.log(`✓ Windows Hello helper built (${fs.statSync(WINDOWS_HELLO_EXE).size} bytes)`);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildWindowsHello();
}
