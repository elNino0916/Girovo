// The product version Girovo tells the bank when a dialog opens (HKVVB).
//
// FinTS allows it five characters (an..5). A longer one stops lib-fints from
// writing the dialog's first message at all, so every login fails — "5.15.1"
// did. Girovo sends its own major.minor ("5.15"), which follows every release
// by itself; a value set in config.json or FINTS_PRODUCT_VERSION wins where
// it fits, and one that does not is cut to its major.minor instead of
// breaking the login.

const MAX_LENGTH = 5;

const majorMinor = (version: string): string => {
  const m = /^(\d+)\.(\d+)/.exec(version.trim());
  return m ? `${m[1]}.${m[2]}` : '';
};

const fits = (v: string) => v.length > 0 && v.length <= MAX_LENGTH;

export function fintsProductVersion(configured: string | undefined, appVersion: string | undefined): string {
  const named = String(configured ?? '').trim();
  if (fits(named)) return named;
  const cut = majorMinor(named);
  if (fits(cut)) return cut;
  const own = majorMinor(String(appVersion ?? ''));
  return fits(own) ? own : '1.0';
}
