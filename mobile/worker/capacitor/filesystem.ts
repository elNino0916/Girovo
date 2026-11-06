// @capacitor/filesystem for the phone server's bundle: the page's Filesystem
// plugin, across the line (./core.ts), with the plugin's own enum values.

import type { FilesystemPlugin } from '@capacitor/filesystem';
import { registerPlugin } from './core';

export enum Directory {
  Documents = 'DOCUMENTS',
  Data = 'DATA',
  Library = 'LIBRARY',
  Cache = 'CACHE',
  External = 'EXTERNAL',
  ExternalStorage = 'EXTERNAL_STORAGE',
  ExternalCache = 'EXTERNAL_CACHE',
  LibraryNoCloud = 'LIBRARY_NO_CLOUD',
  Temporary = 'TEMPORARY',
}

export enum Encoding {
  UTF8 = 'utf8',
  ASCII = 'ascii',
  UTF16 = 'utf16',
}

export const Filesystem = registerPlugin<FilesystemPlugin>('Filesystem');
