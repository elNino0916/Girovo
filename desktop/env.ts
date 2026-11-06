// First of the desktop runtime's modules: the process the route handlers see
// is the desktop app's own (mobile/shims/process.ts starts as the phone's).
// Before any route module loads, since some read the environment as they do.
//
//   GIROVO_DESKTOP   the server that may keep the further banks' PINs and the
//                    background checks' box (lib/linked-unlock.ts,
//                    lib/background-store.ts), as electron/main.cjs set it
//   GIROVO_MODEL_DIR where the category model's small files are mounted
//                    (desktop/server/model.ts); its weights stay in Rust

import { process } from '../mobile/shims/process';
import { shell } from './shell';

const os = shell().platform;
process.platform = os === 'windows' ? 'win32' : os;
process.arch = 'x64';
process.env.GIROVO_DESKTOP = '1';
process.env.GIROVO_MODEL_DIR = '/model';
