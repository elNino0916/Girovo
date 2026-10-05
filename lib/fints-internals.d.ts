// Types for the lib-fints internals re-exported by fints-internals.js.
//
// The runtime values come from deep .js files that ship no colocated
// declarations, but lib-fints does publish the matching declarations under
// dist/types/ — so the shapes below are the library's real ones, not stand-ins.
// Only `registerSegmentDefinition` is declared by hand: it is exported by our
// patch (patches/lib-fints+1.5.2.patch), not by the upstream .d.ts.

export { SegmentDefinition } from '../node_modules/lib-fints/dist/types/segmentDefinition.js';
export { AlphaNumeric } from '../node_modules/lib-fints/dist/types/dataElements/AlphaNumeric.js';
export { Binary } from '../node_modules/lib-fints/dist/types/dataElements/Binary.js';
export { Numeric } from '../node_modules/lib-fints/dist/types/dataElements/Numeric.js';
export { YesNo } from '../node_modules/lib-fints/dist/types/dataElements/YesNo.js';
export { AccountGroup } from '../node_modules/lib-fints/dist/types/dataGroups/Account.js';
export { DataGroup } from '../node_modules/lib-fints/dist/types/dataGroups/DataGroup.js';
export { InternationalAccountGroup } from '../node_modules/lib-fints/dist/types/dataGroups/InternationalAccount.js';
export { CustomerOrderInteraction } from '../node_modules/lib-fints/dist/types/interactions/customerInteraction.js';
export { StatementInteractionCAMT } from '../node_modules/lib-fints/dist/types/interactions/statementInteractionCAMT.js';
export { StatementInteractionMT940 } from '../node_modules/lib-fints/dist/types/interactions/statementInteractionMT940.js';
export { CamtParser } from '../node_modules/lib-fints/dist/types/camtParser.js';
export { TanMediaInteraction } from '../node_modules/lib-fints/dist/types/interactions/tanMediaInteraction.js';

// lib-fints' entry point re-exports neither tanMethod.js nor codes.js, so the
// TAN types are pulled straight from the published declarations.
export type { TanMethod, DecoupledParams } from '../node_modules/lib-fints/dist/types/tanMethod.js';

import type { SegmentDefinition } from '../node_modules/lib-fints/dist/types/segmentDefinition.js';

/** Added by patches/lib-fints+1.5.2.patch — upstream keeps this module-private. */
export declare function registerSegmentDefinition(definition: SegmentDefinition): void;
