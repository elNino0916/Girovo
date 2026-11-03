// @capacitor/filesystem for the background check's bundle (scripts/build-mobile.mjs
// puts this in its place): mobile/shims/fs.ts mounts the state folder through
// it, read through BackgroundJob.java. Writing is never asked for — the check
// calls refuseData() once the folder is mounted — and is refused all the same.

import { bg } from './bridge';

export const Directory = { Data: 'DATA' } as const;
export const Encoding = { UTF8: 'utf8' } as const;

const STATE = 'fints-state';
const refuse = () => Promise.reject(Object.assign(new Error('the background check writes nothing'), { code: 'EROFS' }));

export const Filesystem = {
  async readdir({ path }: { path: string }): Promise<{ files: Array<{ name: string; type: 'file' }> }> {
    if (path !== STATE) return { files: [] };
    // A write the page's runtime did not live to finish is left for it to
    // tidy up (mobile/shims/fs.ts mountData): this side would have to write.
    const names = (JSON.parse(bg().listFiles()) as string[]).filter((name) => !name.endsWith('.part'));
    return { files: names.map((name) => ({ name, type: 'file' as const })) };
  },
  async readFile({ path }: { path: string }): Promise<{ data: string }> {
    const name = path.startsWith(`${STATE}/`) ? path.slice(STATE.length + 1) : '';
    const text = name ? bg().readFile(name) : null;
    if (text == null) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    return { data: text };
  },
  writeFile: refuse,
  deleteFile: refuse,
  rename: refuse,
};
