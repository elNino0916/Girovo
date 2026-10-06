// The interface's texts, for code that is not a React component: a
// formatter, a label table, a route handler, a toast built in a callback.
//
//   msgs().transfer.sent(name)
//
// A component reads the same through useT() (lib/i18n/react.tsx), which also
// renders it again when the language changes. Both answer in the language
// speaking right now (lib/i18n/locale.ts): the page's, or on the server the
// request's own.

import { MESSAGES, type Messages } from './messages/index.ts';
import { activeLocale } from './locale.ts';

export type { Messages };
export { MESSAGES };
export * from './locale.ts';

/** The texts in the language speaking right now. */
export function msgs(): Messages {
  return MESSAGES[activeLocale()];
}
