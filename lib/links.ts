// Girovo's own pages on girovo.de, in the language the app is shown in. One
// place for them: Einstellungen → Über Girovo and the login's privacy notes
// both link the privacy policy.

import type { Locale } from './i18n/locale';

export const WEBSITE_URL = 'https://girovo.de';
export const CONTACT_MAIL = 'contact@girovo.de';

/** The privacy policy (girovo-website pages/privacy.vue). */
export const privacyUrl = (locale: Locale): string =>
  locale === 'de' ? `${WEBSITE_URL}/datenschutz` : `${WEBSITE_URL}/en/privacy`;

/** The Impressum. */
export const imprintUrl = (locale: Locale): string =>
  locale === 'de' ? `${WEBSITE_URL}/impressum` : `${WEBSITE_URL}/en/legal-notice`;
