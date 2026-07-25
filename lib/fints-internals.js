// Re-exports of lib-fints internals that the package's "exports" map hides.
//
// lib-fints only exposes `.` in its exports field, so the segment-definition
// machinery needed to add HKCCS / HKIPZ / HKVMK (see fints-sepa.ts and
// fints-pending.ts) is unreachable through a bare specifier. A relative path
// bypasses the exports gate — Node resolves it as a plain file, and the bundler
// resolves it to the same absolute paths as `import 'lib-fints'`, so the
// library's module-level segment registry stays a single instance.
//
// This file is plain JavaScript on purpose: the deep .js files ship no
// colocated declarations (lib-fints keeps them under dist/types/). The
// hand-written fints-internals.d.ts next to it points TypeScript at those.

export { SegmentDefinition } from '../node_modules/lib-fints/dist/segmentDefinition.js';
export { AlphaNumeric } from '../node_modules/lib-fints/dist/dataElements/AlphaNumeric.js';
export { Binary } from '../node_modules/lib-fints/dist/dataElements/Binary.js';
export { Numeric } from '../node_modules/lib-fints/dist/dataElements/Numeric.js';
export { YesNo } from '../node_modules/lib-fints/dist/dataElements/YesNo.js';
export { AccountGroup } from '../node_modules/lib-fints/dist/dataGroups/Account.js';
export { InternationalAccountGroup } from '../node_modules/lib-fints/dist/dataGroups/InternationalAccount.js';
export { CustomerOrderInteraction } from '../node_modules/lib-fints/dist/interactions/customerInteraction.js';
export { TanMediaInteraction } from '../node_modules/lib-fints/dist/interactions/tanMediaInteraction.js';
export { registerSegmentDefinition } from '../node_modules/lib-fints/dist/segments/registry.js';
