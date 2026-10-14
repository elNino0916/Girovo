// Puts what the desktop ships beside its server into the virtual /app folder —
// before any route module is evaluated, because lib/banks.ts and
// lib/session.ts read theirs while they load. mobile/server/index.ts imports
// this module first for exactly that reason.
//
// `girovo:assets` is written by scripts/build-mobile.mjs from the project's
// own banks-data.json, config.json and public/logos.

import { ASSETS, LISTINGS } from 'girovo:assets';
import { mountAssets } from '../shims/fs';

mountAssets(ASSETS, LISTINGS);
