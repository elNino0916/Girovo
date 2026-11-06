# Makes the font file of the desktop shell's own window — the start window,
# which also draws the first start's migration screen and the install window
# (src-tauri/shell/splash.html) — from the interface face the app itself uses:
# Google Sans Flex, as next/font fetched it (app/layout.tsx).
#
# That window cannot reach the app's own copy: it is up before the page, and
# the install window runs while the installation it would read from is being
# replaced. So it brings its own, served from the binary (src-tauri/src/shell.rs):
#
#   src-tauri/shell/fonts/google-sans-flex-latin.woff2
#       The Latin subset exactly as the app serves it — variable, so the start
#       window sets it as the app does (weight and optical size).
#
# Run once after `next dev` or `next build` has fetched the font, then commit
# the result; nothing in the build depends on this script or on fontTools:
#   pip install --user fonttools brotli
#   python scripts/make-window-fonts.py

import glob
import os
import shutil
import sys

from fontTools.ttLib import TTFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'src-tauri', 'shell', 'fonts', 'google-sans-flex-latin.woff2')

# What the window says must be there: German, the euro, the typographic marks.
NEEDED = 'äöüßÄÖÜ€–…„“'


def find_source():
    """The Latin subset of Google Sans Flex among next/font's downloads."""
    for path in sorted(glob.glob(os.path.join(ROOT, '.next', '**', 'media', '*.woff2'), recursive=True)):
        font = TTFont(path)
        family = font['name'].getDebugName(16) or font['name'].getDebugName(1) or ''
        if family != 'Google Sans Flex' or 'fvar' not in font:
            continue
        cmap = font.getBestCmap()
        if all(ord(c) in cmap for c in NEEDED):
            return path
    return None


def main():
    source = find_source()
    if not source:
        sys.exit('no Google Sans Flex (Latin) under .next — run `next dev` or `next build` first')
    print('source:', os.path.relpath(source, ROOT))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    shutil.copyfile(source, OUT)
    print('wrote', os.path.relpath(OUT, ROOT), os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
