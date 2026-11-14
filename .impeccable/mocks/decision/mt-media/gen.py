# Writes board.html: four ways to show the MT-Media logo in "MT-Media als
# Herausgeber" (components/settings/PublisherCert.tsx) and its settings row,
# each in light (certificate trusted) and dark (not installed).
# Logo versions come from logos.py. Render: see render.cmd.
import os

HERE = os.path.dirname(os.path.abspath(__file__))

SHA256 = '0F12 F14D 5959 82FF 1B01 7F86 0169 A51E BD46 4CEA A602 30E0 4192 B7E2 E089 5AB5'
SHA1 = '0799 5B74 08F1 4820 85F8 DC23 9DEC 4294 F0CA F149'

SHIELD = '<span class="ms">{}</span>'


def logo(kind, theme, part):
    """kind: color | mono ; part: mark | wordmark"""
    if kind == 'color':
        f = f'{part}.png' if theme == 'light' else f'{part}-dark.png'
    else:
        f = f'{part}-mono-ink.png' if theme == 'light' else f'{part}-mono-light.png'
    return f


def details(theme, trusted, with_status=True):
    status = ('<span class="ok">Installiert, Windows vertraut MT-Media</span>' if trusted
              else 'Zertifikat nicht installiert')
    rows = [
        ('Herausgeber', 'MT-Media'),
        ('Art', 'Codesignatur'),
        ('Verfahren', 'SHA-256, RSA 3072'),
        ('Gültig bis', '14.11.2028'),
        ('Fingerabdruck (SHA-256)', f'<span class="mono">{SHA256}</span>'),
        ('Fingerabdruck (SHA-1)', f'<span class="mono">{SHA1}</span>'),
    ]
    if with_status:
        rows.append(('Status', status))
    return '<dl>' + ''.join(f'<dt>{k}</dt><dd>{v}</dd>' for k, v in rows) + '</dl>'


def actions(trusted):
    if trusted:
        return '<div class="acts"><span class="btn tonal">Schließen</span><span class="btn tonal">Zertifikat entfernen</span></div>'
    return '<div class="acts"><span class="btn tonal">Schließen</span><span class="btn primary">Zertifikat installieren</span></div>'


DESC = 'Girovo ist von MT-Media signiert. Mit diesem Zertifikat zeigt Windows MT-Media als Herausgeber.'
NOTE = '<p class="note">Freiwillig. Girovo läuft auch ohne.</p>'


def row(theme, icon, trusted):
    sub = 'Installiert, Windows vertraut MT-Media' if trusted else 'Zertifikat nicht installiert'
    return f'''<div class="grp">Herausgeber</div>
<div class="row">{icon}<div class="rt"><div class="t">MT-Media als Herausgeber</div><div class="s">{sub}</div></div><span class="ms chev">chevron_right</span></div>'''


# ---- A · Direkt auf der Fläche ------------------------------------------------------
def a(theme, trusted):
    lock = f'<div class="lockA"><img src="{logo("color", theme, "mark")}" class="m"><img src="{logo("color", theme, "wordmark")}" class="w"></div>'
    dialog = f'''<div class="dlg"><div class="hd"><span class="ic">{SHIELD.format("verified_user" if trusted else "shield")}</span><h3>MT-Media als Herausgeber</h3><p>{DESC}</p></div>
{lock}{details(theme, trusted)}{NOTE}{actions(trusted)}</div>'''
    icon = f'<img class="rowmark" src="{logo("color", theme, "mark")}">'
    return dialog + row(theme, icon, trusted)


# ---- B · Absenderkarte --------------------------------------------------------------
def b(theme, trusted):
    chip = ('<span class="chip ok"><span class="ms">check_circle</span>Vertraut</span>' if trusted
            else '<span class="chip"><span class="ms">remove_circle_outline</span>Nicht installiert</span>')
    card = f'''<div class="card"><span class="disc lg"><img src="{logo("color", theme, "mark")}"></span>
<div class="ct"><img class="cw" src="{logo("color", theme, "wordmark")}" alt="MT-Media">{chip}</div></div>'''
    dialog = f'''<div class="dlg"><div class="hd"><h3>MT-Media als Herausgeber</h3><p>{DESC}</p></div>
{card}{details(theme, trusted, with_status=False)}{NOTE}{actions(trusted)}</div>'''
    icon = f'<span class="disc"><img src="{logo("color", theme, "mark")}"></span>'
    return dialog + row(theme, icon, trusted)


# ---- C · Logo als Kopf --------------------------------------------------------------
def c(theme, trusted):
    badge = '<span class="badge ok"><span class="ms">check</span></span>' if trusted else ''
    head = f'''<div class="hdC"><span class="seal"><img src="{logo("color", theme, "mark")}">{badge}</span>
<img class="wC" src="{logo("color", theme, "wordmark")}" alt="MT-Media"></div>'''
    line = ('<div class="stateline ok"><span class="ms">verified_user</span>Windows vertraut MT-Media als Herausgeber</div>' if trusted
            else '<div class="stateline"><span class="ms">shield</span>Zertifikat nicht installiert</div>')
    dialog = f'''<div class="dlg">{head}<p class="descC">{DESC}</p>{line}
{details(theme, trusted, with_status=False)}{NOTE}{actions(trusted)}</div>'''
    icon = f'<span class="disc">{"<img src=" + chr(34) + logo("color", theme, "mark") + chr(34) + ">"}{"<span class=" + chr(34) + "badge sm ok" + chr(34) + "><span class=" + chr(34) + "ms" + chr(34) + ">check</span></span>" if trusted else ""}</span>'
    return dialog + row(theme, icon, trusted)


# ---- D · Einfarbig ------------------------------------------------------------------
def d(theme, trusted):
    sig = f'<div class="sig"><span>Signiert von</span><img src="{logo("mono", theme, "wordmark")}" alt="MT-Media"></div>'
    dialog = f'''<div class="dlg"><div class="hd"><span class="ic">{SHIELD.format("verified_user" if trusted else "shield")}</span><h3>MT-Media als Herausgeber</h3><p>{DESC}</p></div>
{sig}{details(theme, trusted)}{NOTE}{actions(trusted)}</div>'''
    icon = f'<img class="rowmark mono" src="{logo("mono", theme, "mark")}">'
    return dialog + row(theme, icon, trusted)


COLS = [
    ('A · Direkt auf der Fläche', 'The full logo without a plate. Light uses the original; dark uses a version with the letters in Girovo\'s light ink and the blues brightened. Closest to today, minus the white box.', a),
    ('B · Absenderkarte', 'The logo as the sender: a tonal card with the mark in a disc, the wordmark and the state as a chip under it. The row gets the same disc as every avatar in Girovo.', b),
    ('C · Logo als Kopf', 'The logo replaces the shield at the top: the mark in a disc with a green check once Windows trusts it, the wordmark under it. The state gets its own line.', c),
    ('D · Einfarbig', 'The quietest: the logo in one colour, Girovo\'s text colour, as a signature line. Brand blue is left out; MT-Media reads as a fact, not an ad.', d),
]

cols = ''
for name, why, fn in COLS:
    cols += f'''<div class="col"><h2>{name}</h2><p class="why">{why}</p>
<div class="theme light">{fn("light", True)}</div>
<div class="theme dark">{fn("dark", False)}</div></div>'''

src = open(os.path.join(HERE, 'board.tpl.html'), encoding='utf-8').read()
open(os.path.join(HERE, 'board.html'), 'w', encoding='utf-8').write(src.replace('TEMPLATE', cols))
print('ok')
