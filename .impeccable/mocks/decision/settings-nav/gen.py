# Writes the three directions (a, b, c) in dark and light, and the board. Mock only.
import os
HERE = os.path.dirname(os.path.abspath(__file__))

AI = '<svg class="mk" width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="var(--ai)" stroke-linecap="round"><path d="M12 2.6v6.2M12 15.2v6.2M2.6 12h6.2M15.2 12h6.2" stroke-width="2.7"/><path d="M17.4 4.6l-1.9 1.9M6.6 17.4l1.9-1.9" stroke-width="2.2" opacity=".55"/></svg>'
API = '<svg class="mk" width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="var(--api)" stroke-linecap="round"><path d="M12 9.4V7.4M14.6 12h2M12 14.6v2M9.4 12h-2" stroke-width="2.7"/><g fill="var(--api)" stroke="none"><circle cx="12" cy="3.5" r="2.3"/><circle cx="20.5" cy="12" r="2.3"/><circle cx="12" cy="20.5" r="2.3"/><circle cx="3.5" cy="12" r="2.3"/></g></svg>'

# id, name, glyph, summary, options (for C's cards)
PAGES = [
    ('ask', 'Girovo AI', 'ai', 'Antworten in ganzen Sätzen', ['Girovo AI', 'Sprachmodell', 'Kategorisieren', 'Namen aufräumen']),
    ('api', 'Girovo API', 'api', 'Kommt bald', ['Kommt bald']),
    ('security', 'Sicherheit & Datenschutz', 'lock', 'Windows Hello, Abmelden', ['Windows Hello', 'Automatisch abmelden', 'Gerät gemerkt', 'Firmenlogos']),
    ('notifications', 'Benachrichtigungen', 'notifications', 'Neue Umsätze werden gemeldet', ['Neue Umsätze melden', 'Zahlungshinweise']),
    ('accounts', 'Umsätze & Kategorien', 'account_balance_wallet', 'Salden, Umsätze, Kategorien', ['Beim Anmelden abrufen', 'Umsätze behalten', 'Kategorien', 'Import']),
    ('devices', 'Daten & Sicherung', 'desktop_windows', 'Abgleich, Sicherung', ['Abgleich', 'Sicherung erstellen', 'Gespeicherte Daten']),
    ('appearance', 'Sprache & Darstellung', 'language', 'Deutsch · System', ['Sprache', 'Hell oder dunkel']),
    ('updates', 'Updates', 'download', 'Kanal: Next', ['Updatekanal', 'Frühe Updates', 'Update aus Datei']),
    ('about', 'Über Girovo Next', 'info', 'Version 7.0.0', ['Version 7.0.0', 'Kontakt', 'Rechtliches']),
]
GROUPS = [('Girovo AI', ['ask', 'api']), ('Konto & Sicherheit', ['security', 'notifications']),
          ('Deine Daten', ['accounts', 'devices']), ('App', ['appearance', 'updates', 'about'])]
BY = {p[0]: p for p in PAGES}
CUR = 'security'

def glyph(g, size=22, fill=False):
    if g == 'ai': return AI.format(s=size)
    if g == 'api': return API.format(s=size)
    return f'<span class="ms{" fill" if fill else ""}" style="font-size:{size}px">{g}</span>'

def frame(side, sheet, cls, side_w=272):
    return f'''<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="nav.css"><link rel="stylesheet" href="dirs.css"></head>
<body class="{cls}" style="--side-w:{side_w}px">
<div class="tb"><span class="menu ms">menu</span><div class="brand"><span class="plate">€</span><span>Girovo <span class="nx">Next</span></span></div>
<div class="search" style="margin-left:{side_w - 272}px"><span class="ms">search</span>Umsätze suchen oder fragen<span class="key">Strg K</span></div>
<div class="acts"><span class="ms">notifications</span><span class="ms">visibility</span><span><b class="avatar">NB</b></span></div></div>
<div class="caption"><i>&#xE921;</i><i>&#xE922;</i><i>&#xE8BB;</i></div>
<nav class="side" style="width:{side_w}px">{side}</nav>
<main class="sheet" style="left:{side_w}px">{sheet}</main></body></html>'''

def security_page(crumb=False, mark=None):
    hl = lambda k: ' hl' if mark == k else ''
    head = '<div class="crumb"><a>Einstellungen</a><span class="ms">chevron_right</span></div>' if crumb else ''
    return f'''<div class="col">{head}<h1 class="ptitle">Sicherheit &amp; Datenschutz</h1>
<div class="gh">Anmeldung</div><div class="grp">
<div class="r{hl('hello')}"><span class="ms">face</span><div class="tx"><div class="t">Windows Hello</div><div class="s">Gesicht oder Fingerabdruck statt der PIN</div></div><span class="sw"></span></div>
<div class="r"><span class="ms">key</span><div class="tx"><div class="t">Sicherheitsschlüssel</div><div class="s">2 Schlüssel</div></div><span class="v"><span class="ms">chevron_right</span></span></div>
<div class="r"><span class="ms">link</span><div class="tx"><div class="t">Weitere Banken mit anmelden</div><div class="s">Mit der ersten Anmeldung</div></div><span class="sw off"></span></div>
<div class="r{hl('idle')}"><span class="ms">schedule</span><div class="tx"><div class="t">Automatisch abmelden</div><div class="s">Eine Minute vorher fragt Girovo nach.</div></div><span class="v">nach 10 Min<span class="ms">expand_more</span></span></div>
</div>
<div class="gh">Dieses Gerät</div><div class="grp">
<div class="r"><span class="ms">verified_user</span><div class="tx"><div class="t">Gerät gemerkt</div><div class="s">Deine Bank fragt seltener nach einer Freigabe.</div></div><span class="tbtn">Vergessen</span></div>
</div>
<div class="gh">Was das Gerät verlässt</div><div class="grp">
<div class="r"><span class="ms">image</span><div class="tx"><div class="t">Firmenlogos</div><div class="s">Nur bereinigte Firmennamen gehen an Brandfetch.</div></div><span class="sw"></span></div>
<div class="r"><span class="ms">bar_chart</span><div class="tx"><div class="t">Nutzungsdaten</div><div class="s">Hilft, Girovo besser zu machen.</div></div><span class="sw off"></span></div>
</div></div>'''

# A: Gruppen. One line per page, the pages in four named groups, search on top, the way back quiet, no gear at the foot.
def side_a():
    out = ['<a class="back"><span class="ms">arrow_back</span>Übersicht</a>',
           '<div class="a-title">Einstellungen</div>',
           '<div class="sfield"><span class="ms">search</span>In Einstellungen suchen</div>']
    for name, ids in GROUPS:
        out.append(f'<div class="a-gl">{name}</div>')
        for i in ids:
            pid, n, g, s, _ = BY[i]
            on = pid == CUR
            out.append(f'<a class="a-it{" on" if on else ""}">{glyph(g, 22, on)}<span>{n}</span></a>')
    out.append('<div class="foot a-ver">Girovo Next 7.0.0</div>')
    return ''.join(out)

# B: Mit Inhalt. Each page with what is on it, in grouped tonal blocks like the phone's list.
def side_b():
    out = ['<div class="b-head"><span class="b-back ms">arrow_back</span><span>Einstellungen</span></div>',
           '<div class="sfield"><span class="ms">search</span>In Einstellungen suchen</div>']
    for name, ids in GROUPS:
        out.append('<div class="b-grp">')
        for i in ids:
            pid, n, g, s, _ = BY[i]
            on = pid == CUR
            out.append(f'<a class="b-it{" on" if on else ""} b-{g if g in ("ai", "api") else "x"}"><span class="b-disc">{glyph(g, 20, on)}</span><span class="b-tx"><b>{n}</b><i>{s}</i></span></a>')
        out.append('</div>')
    return ''.join(out)

# C: Übersicht. The sidebar stays the app's own; Einstellungen opens a home on the sheet that lists every option by name.
def side_c():
    places = [('home', 'Übersicht'), ('swap_horiz', 'Zahlungen'), ('bar_chart', 'Analyse')]
    out = ['<a class="c-fab"><span class="ms">swap_horiz</span>Überweisen</a>']
    out += [f'<a class="c-pl"><span class="ms">{g}</span>{n}</a>' for g, n in places]
    out.append('<div class="c-gl">Konten</div>')
    for n in ['Giro Haushalt', 'GiroKomfort', 'Notgroschen', 'Visa Classic']:
        out.append(f'<div class="c-acc"><span class="c-cb ms fill">check_box</span>{n}</div>')
    out.append('<a class="c-pl on foot"><span class="ms fill">settings</span>Einstellungen</a>')
    return ''.join(out)

def home_c():
    cards = []
    for pid, n, g, s, opts in PAGES:
        links = ''.join(f'<li>{o}</li>' for o in opts)
        cards.append(f'<div class="c-card c-{g if g in ("ai", "api") else "x"}"><div class="c-ch"><span class="b-disc">{glyph(g, 20)}</span><b>{n}</b></div><ul>{links}</ul></div>')
    return f'''<div class="c-col"><h1 class="c-h">Einstellungen</h1>
<div class="c-search"><span class="ms">search</span>Einstellung suchen, z. B. Windows Hello</div>
<div class="c-grid">{''.join(cards)}</div></div>'''

DIRS = {
    'a': (side_a, lambda: security_page(), 272),
    'b': (side_b, lambda: security_page(), 320),
}
for k, (side, sheet, w) in DIRS.items():
    for theme in ('dark', 'light'):
        open(os.path.join(HERE, f'{k}-{theme}.html'), 'w', encoding='utf-8').write(frame(side(), sheet(), f'{theme} dir-{k}', w))
open(os.path.join(HERE, 'c-dark.html'), 'w', encoding='utf-8').write(frame(side_c(), home_c(), 'dark dir-c'))
open(os.path.join(HERE, 'c-light.html'), 'w', encoding='utf-8').write(frame(side_c(), security_page(crumb=True, mark='idle'), 'light dir-c'))
print('ok')
