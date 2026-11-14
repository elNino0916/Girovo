# Round 2: Girovo AI wordmarks beside the chosen Girovo API one (D, Eingabe), and the current AI mark improved. Mock only.
import os
HERE = os.path.dirname(os.path.abspath(__file__))

def star(cx, cy, r, k=0.16):
    d = r * k
    return (f'M{cx} {cy-r} Q{cx+d} {cy-d} {cx+r} {cy} Q{cx+d} {cy+d} {cx} {cy+r} '
            f'Q{cx-d} {cy+d} {cx-r} {cy} Q{cx-d} {cy-d} {cx} {cy-r}Z')

NOW = '<path d="M12 2.6v6.2M12 15.2v6.2M2.6 12h6.2M15.2 12h6.2" stroke-width="2.7"/><path d="M17.4 4.6l-1.9 1.9M6.6 17.4l1.9-1.9" stroke-width="2.2" opacity=".55"/>'
API = '<path d="M8.6 6.2 3.4 12l5.2 5.8M15.4 6.2 20.6 12l-5.2 5.8" stroke-width="2.7"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>'
def g(body, size=None, color='currentColor', cls='mk'):
    sz = f' width="{size}" height="{size}"' if size else ''
    return f'<svg class="{cls}"{sz} viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-linecap="round" stroke-linejoin="round" style="color:{color}">{body}</svg>'

def api_wm():
    return '<span class="w4 api">Girovo<span class="tag">API</span><span class="cur"></span></span>'

# ---------- AI wordmarks ----------
def wm(d, rest=''):
    tail = f'<span class="rest">{rest}</span>' if rest else ''
    if d == 'e1':  # spark where the API has its cursor
        return f'<span class="e1">Girovo<span class="tag">AI</span>{g(NOW, color="var(--ai)", cls="spk")}{tail}</span>'
    if d == 'e2':  # typing
        return f'<span class="e2">Girovo<span class="tag">AI</span><span class="dots"><i></i><i></i><i></i></span>{tail}</span>'
    if d == 'e3':  # the weight rises letter by letter
        letters = 'Girovo'
        ws = [330, 380, 430, 480, 530, 580]
        word = ''.join(f'<span style="font-variation-settings:\'wght\' {w}">{c}</span>' for c, w in zip(letters, ws))
        return f'<span class="e3">{word} <span class="tag">AI</span>{tail}</span>'
    if d == 'e4':  # the mark leads, the tag in mono
        return f'<span class="e4">{g(NOW, color="var(--ai)", cls="lead")}Girovo<span class="tag">AI</span>{tail}</span>'

WORDS = [
    ('e1', 'E · Funke', 'Wie Girovo API, nur sitzt statt des Cursors der Funke hinter "AI". Beide Namen sind sofort eine Familie.'),
    ('e2', 'F · Tippt', '"AI" in der Monoschrift, dahinter drei Punkte wie beim Schreiben einer Antwort. Passt zum Gespräch.'),
    ('e3', 'G · Steigend', '"Girovo" wird Buchstabe für Buchstabe kräftiger, "AI" am kräftigsten in Violett. Nutzt die variable Schrift.'),
    ('e4', 'H · Marke vorn', 'Der Funke steht vor dem Namen, "AI" in der Monoschrift. Eine kleine Wortbildmarke, die überall gleich bleibt.'),
]

def wpanel(d, theme):
    ai_disc = f'<span class="disc" style="background:color-mix(in srgb,var(--ai) 18%,transparent)">{g(NOW, 20, "var(--ai)")}</span>'
    api_disc = f'<span class="disc" style="background:color-mix(in srgb,var(--api) 18%,transparent)">{g(API, 20, "var(--api)")}</span>'
    bar_mark = '' if d == 'e4' else g(NOW, 20, 'var(--ai)')
    return f'''<div class="ctx {theme}"><div class="wgrid">
  <div class="c c-head">{wm(d)}</div>
  <div class="c c-bar">{bar_mark}<span class="bt">{wm(d)}</span><span class="x">✕</span></div>
  <div class="c c-row">{ai_disc}<div><div class="t">{wm(d)}</div><div class="s">Antworten in ganzen Sätzen</div></div><span class="sw"></span></div>
  <div class="c c-ready"><div class="rt">{wm(d, rest=' ist bereit')}</div><div class="rs">Frag etwas zu deinen Umsätzen.</div></div>
  <div class="c c-api"><div class="side">{ai_disc}<div>{wm(d)}<i>Antworten in ganzen Sätzen</i></div></div><div class="side">{api_disc}<div>{api_wm()}<i>Kommt bald</i></div></div></div>
</div></div>'''

CSS2 = '''
.e1,.e2,.e4{white-space:nowrap}
.e1 .tag,.e2 .tag,.e4 .tag{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:.94em;letter-spacing:-.01em;color:var(--ai);margin-left:.2em}
.e1 .spk{display:inline-block;width:.78em;height:.78em;margin-left:.16em;vertical-align:-.06em}
.e2 .dots{display:inline-flex;gap:.12em;margin-left:.2em;vertical-align:.02em}
.e2 .dots i{width:.17em;height:.17em;border-radius:50%;background:var(--ai)}
.e2 .dots i:nth-child(2){opacity:.7}.e2 .dots i:nth-child(3){opacity:.4}
.e3{white-space:nowrap}.e3 .tag{font-variation-settings:'wght' 760;color:var(--ai);letter-spacing:.01em}
.e3 .rest{font-variation-settings:'wght' 500}
.e4 .lead{display:inline-block;width:.95em;height:.95em;margin-right:.3em;vertical-align:-.14em}
.c-api{flex-wrap:wrap}
'''
wrows = ''.join(f'<section class="lgrid"><div class="lead"><h2>{n}</h2><p>{w}</p></div>{wpanel(d, "dark")}{wpanel(d, "light")}</section>' for d, n, w in WORDS)
open(os.path.join(HERE, 'wordmarks2.html'), 'w', encoding='utf-8').write(f'''<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="brand.css"><style>body{{width:1640px}}{CSS2}</style></head><body>
<h1>Girovo AI neben Girovo API</h1><p class="intro">Girovo API ist jetzt D ("Girovo" und "API" in der Monoschrift mit Cursor). Vier Wortmarken für Girovo AI, die dazu passen. Unten in jedem Feld beide nebeneinander wie in der Seitenleiste.</p>
<div class="lgrid"><span></span><span class="colhead">Dunkel</span><span class="colhead">Hell</span></div>{wrows}</body></html>''')

# ---------- the current mark, improved ----------
def wedge(angle, inner=9.0, tip=2.4, wi=3.3, wt=1.3, opacity=1):
    """A ray from the centre gap out to a round tip, wider near the centre, rotated about (12,12)."""
    h, t = wi / 2, wt / 2
    d = (f'M{12-h} {inner} L{12-t} {tip+0.4} Q12 {tip-0.5} {12+t} {tip+0.4} L{12+h} {inner} Q12 {inner+0.9} {12-h} {inner}Z')
    return f'<path d="{d}" fill="currentColor" stroke="none" opacity="{opacity}" transform="rotate({angle} 12 12)"/>'

TAPER = ''.join(wedge(a) for a in (0, 90, 180, 270)) + wedge(45, 9.6, 4.9, 2.4, 1.1, .55) + wedge(225, 9.6, 4.9, 2.4, 1.1, .55)
LOGOS = [
    ('now', 'Heute', 'Vier Striche, zwei Diagonalen halb so kräftig.', NOW),
    ('core', '1 · Mit Kern', 'Ein Punkt in der Mitte schließt die Lücke. Klein liest es sich als ein Zeichen statt sechs Striche.',
     NOW + '<circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>'),
    ('taper', '2 · Verjüngt', 'Die Strahlen werden zur Spitze hin schmaler wie ein Funkeln. Feiner, ohne die Form zu ändern.', TAPER),
    ('weighted', '3 · Ausgewogen', 'Senkrecht etwas länger als waagrecht, die Diagonalen kürzer, dafür voll. Optisch ruhiger und kräftiger.',
     '<path d="M12 1.8v6.6M12 15.6v6.6M3.4 12h5.4M15.2 12h5.4" stroke-width="2.9"/><path d="M16.6 5.4l-1.5 1.5M7.4 18.6l1.5-1.5" stroke-width="2.4"/>'),
    ('twinkle', '4 · Mit Begleiter', 'Statt der Diagonalen ein kleiner gefüllter Funke oben rechts. Lebendiger, noch klar dieselbe Marke.',
     f'<path d="M12 4.2v5M12 14.8v5.6M3.6 12h5.4M15 12h5.4" stroke-width="2.7"/><path d="{star(19.2, 4.8, 3.2, 0.14)}" fill="currentColor" stroke="none"/>'),
    ('duo', '5 · Zweifarbig', 'Die Striche in Violett, die Diagonalen in Girovos Blau: Girovo Next und Girovo in einer Marke.',
     '<path d="M12 2.6v6.2M12 15.2v6.2M2.6 12h6.2M15.2 12h6.2" stroke-width="2.7"/><path d="M17.4 4.6l-1.9 1.9M6.6 17.4l1.9-1.9" stroke-width="2.4" stroke="var(--api)"/>'),
]

def lpanel(body, theme):
    sizes = ''.join(g(body, s) for s in (16, 20, 24, 32, 48))
    plate_body = body.replace('stroke="var(--api)"', 'stroke="#bfe0ff"')
    return f'''<div class="ctx {theme}"><div class="lctx">
  <div class="plate">{g(plate_body, color='#fff')}</div>
  <div class="sizes">{sizes}</div>
  <div class="pair"><div class="it"><span class="disc" style="background:color-mix(in srgb,var(--ai) 18%,transparent)">{g(body, 20, 'var(--ai)')}</span>Girovo AI</div>
    <div class="it"><span class="disc" style="background:color-mix(in srgb,var(--api) 18%,transparent)">{g(API, 20, 'var(--api)')}</span>Girovo API</div></div>
  <div class="ready"><span class="big">{g(body, 26, 'var(--ai)')}</span>Girovo AI ist bereit</div>
</div></div>'''

lrows = ''.join(f'<section class="lgrid"><div class="lead"><h2>{n}</h2><p>{w}</p></div>{lpanel(b, "dark")}{lpanel(b, "light")}</section>' for k, n, w, b in LOGOS)
open(os.path.join(HERE, 'logos2.html'), 'w', encoding='utf-8').write(f'''<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="brand.css"><style>body{{width:1400px}}.lgrid{{grid-template-columns:240px 1fr 1fr}}</style></head><body>
<h1>Die Girovo AI Marke, verbessert</h1><p class="intro">Die heutige Marke bleibt, fünf Wege sie zu verfeinern. Jede auf der Plakette, in den kleinen Größen, neben den Klammern von Girovo API und in "Girovo AI ist bereit".</p>
<div class="lgrid"><span></span><span class="colhead">Dunkel</span><span class="colhead">Hell</span></div>{lrows}</body></html>''')
print('ok')
