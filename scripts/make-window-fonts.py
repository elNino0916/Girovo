# Makes the font files of the windows outside the page — the start window
# (electron/splash.html) and the update and error window
# (build/update-window/UpdateWindow.cs) — from the interface face the app
# itself uses: Google Sans Flex, as next/font fetched it (app/layout.tsx).
#
# Neither window can reach the app's own copy: the start window is up before
# the app's server, and the update window runs while the installation it would
# read from is being replaced. So each brings its own:
#
#   electron/fonts/google-sans-flex-latin.woff2
#       The Latin subset exactly as the app serves it — variable, so the start
#       window sets it as the app does (weight and optical size).
#   build/update-window/fonts/GirovoSans-*.ttf
#       WPF reads neither WOFF2 nor a variable font's axes, so the update window
#       gets fixed instances of the same subset, at the optical sizes its text
#       is set in: 14 for the text (400, 500, 700), 24 for the headline (500).
#       A modified version, so under a name of its own (SIL OFL 1.1, §3), the
#       licence and the source named in its metadata.
#
# Run once after `next dev` or `next build` has fetched the font, then commit
# the results; nothing in the build depends on this script or on fontTools:
#   pip install --user fonttools brotli
#   python scripts/make-window-fonts.py

import glob
import os
import shutil
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SPLASH_OUT = os.path.join(ROOT, 'electron', 'fonts', 'google-sans-flex-latin.woff2')
WINDOW_OUT = os.path.join(ROOT, 'build', 'update-window', 'fonts')

# What the windows say must be there: German, the euro, the typographic marks.
NEEDED = 'äöüßÄÖÜ€–…„“'

LICENSE = ('This Font Software is licensed under the SIL Open Font License, Version 1.1. '
           'This license is available with a FAQ at: https://openfontlicense.org')

# (file, family, style, weight, optical size)
INSTANCES = [
    ('GirovoSans-Regular.ttf', 'Girovo Sans', 'Regular', 400, 14),
    ('GirovoSans-Medium.ttf', 'Girovo Sans', 'Medium', 500, 14),
    ('GirovoSans-Bold.ttf', 'Girovo Sans', 'Bold', 700, 14),
    ('GirovoSansDisplay-Medium.ttf', 'Girovo Sans Display', 'Medium', 500, 24),
]


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


def name(font, family, style, weight, opsz):
    """Names for a static face that WPF groups by family and picks by weight."""
    table = font['name']
    legacy_family = family if style in ('Regular', 'Bold') else f'{family} {style}'
    legacy_style = style if style in ('Regular', 'Bold') else 'Regular'
    full = f'{family} {style}'
    postscript = f"{family.replace(' ', '')}-{style}"
    copyright_ = table.getDebugName(0) or ''
    table.names = []
    for name_id, value in {
        0: copyright_,
        1: legacy_family,
        2: legacy_style,
        3: f'{postscript};girovo',
        4: full,
        5: 'Version 1.000',
        6: postscript,
        10: f'Google Sans Flex at wght {weight}, opsz {opsz} (Latin subset), as a static face for Girovo.',
        13: LICENSE,
        14: 'https://openfontlicense.org',
        16: family,
        17: style,
    }.items():
        table.setName(value, name_id, 3, 1, 0x409)
    os2 = font['OS/2']
    os2.usWeightClass = weight
    # fsSelection: bit 0 italic, 5 bold, 6 regular.
    os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b100000 if style == 'Bold' else 0) | (0b1000000 if style == 'Regular' else 0)
    font['head'].macStyle = 1 if style == 'Bold' else 0


def main():
    source = find_source()
    if not source:
        sys.exit('no Google Sans Flex (Latin) under .next — run `next dev` or `next build` first')
    print('source:', os.path.relpath(source, ROOT))

    os.makedirs(os.path.dirname(SPLASH_OUT), exist_ok=True)
    shutil.copyfile(source, SPLASH_OUT)
    print('wrote', os.path.relpath(SPLASH_OUT, ROOT), os.path.getsize(SPLASH_OUT), 'bytes')

    os.makedirs(WINDOW_OUT, exist_ok=True)
    for file, family, style, weight, opsz in INSTANCES:
        variable = TTFont(source)
        static = instancer.instantiateVariableFont(variable, {'wght': weight, 'opsz': opsz})
        for table in ('STAT', 'fvar', 'avar'):
            if table in static:
                del static[table]
        name(static, family, style, weight, opsz)
        static.flavor = None
        out = os.path.join(WINDOW_OUT, file)
        static.save(out)
        print('wrote', os.path.relpath(out, ROOT), os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
