# Girovo AI / Girovo API wordmarks (four directions) and Girovo AI logos (five). Mock only.
import os
HERE = os.path.dirname(os.path.abspath(__file__))

def star(cx, cy, r, k=0.16):
    """A four-point star with concave sides; k pulls the control points off the centre (fatter)."""
    d = r * k
    return (f'M{cx} {cy-r} Q{cx+d} {cy-d} {cx+r} {cy} Q{cx+d} {cy+d} {cx} {cy+r} '
            f'Q{cx-d} {cy+d} {cx-r} {cy} Q{cx-d} {cy-d} {cx} {cy-r}Z')

AI_NOW = '<path d="M12 2.6v6.2M12 15.2v6.2M2.6 12h6.2M15.2 12h6.2" stroke-width="2.7"/><path d="M17.4 4.6l-1.9 1.9M6.6 17.4l1.9-1.9" stroke-width="2.2" opacity=".55"/>'
API = '<path d="M8.6 6.2 3.4 12l5.2 5.8M15.4 6.2 20.6 12l-5.2 5.8" stroke-width="2.7"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>'
def g(body, size=None, cls='mk', color='currentColor'):
    sz = f' width="{size}" height="{size}"' if size else ''
    return f'<svg class="{cls}"{sz} viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-linecap="round" stroke-linejoin="round" style="color:{color}">{body}</svg>'

# ---------- wordmarks ----------
DOT_AI = f'<svg class="dot" viewBox="0 0 10 10"><path d="{star(5,5,5,0.2)}" fill="var(--ai)"/></svg>'
DOT_API = '<svg class="dot" viewBox="0 0 10 10"><rect x="1.6" y="1.6" width="6.8" height="6.8" rx="1.6" fill="var(--api)" transform="rotate(45 5 5)"/></svg>'
TAG_AI = ('<svg class="tag" viewBox="-1.6 0 28.2 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'
          '<path d="M2 22 9.5 2 17 22M24 2v20" stroke-width="4"/><path d="M9.5 11.6v6.8M6.1 15h6.8" stroke-width="3"/></svg>')
TAG_API = ('<svg class="tag" viewBox="-1.6 0 42.2 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'
           '<path d="M2 22 9.5 2 17 22M23 22V2h5.5a5.5 5.5 0 0 1 0 11H23M38 2v20" stroke-width="4"/><circle cx="9.5" cy="15.6" r="2.1" fill="currentColor" stroke="none"/></svg>')

def wm(d, kind='ai', rest='', stacked=False):
    api = kind == 'api'
    tail = f'<span class="rest">{rest}</span>' if rest else ''
    if d == 'w1':
        dot = DOT_API if api else DOT_AI
        word = '<span class="tag">ap<span class="dl">ı' + dot + '</span></span>' if api else '<span class="tag">a<span class="dl">ı' + dot + '</span></span>'
        return f'<span class="w1{" api" if api else ""}">gırovo {word}{tail}</span>'.replace('gırovo', 'g<span class="dl">ı<svg class="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.6" fill="currentColor"/></svg></span>rovo')
    if d == 'w2':
        return f'<span class="w2{" api" if api else ""}">Girovo {TAG_API if api else TAG_AI}{tail}</span>'
    if d == 'w3':
        tile = g(API if api else AI_NOW, color='currentColor')
        name = 'API' if api else 'AI'
        return f'<span class="w3{" api" if api else ""}{"" if stacked else " inline"}"><span class="tile">{tile}</span><span class="tiers"><small>Girovo</small><b>{name}</b></span>{tail}</span>'
    if d == 'w4':
        cur = '' if rest else '<span class="cur"></span>'
        return f'<span class="w4{" api" if api else ""}">Girovo<span class="tag">{"API" if api else "AI"}</span>{cur}{tail}</span>'
    return f'<span>Girovo {"API" if api else "AI"}{tail}</span>'

WORDS = [
    ('w1', 'A · Rund', 'Klein geschrieben, ganz runde Enden aus der variablen Schrift. Der i-Punkt von "ai" ist ein Funke, bei "api" ein blaues Karo. Freundlich, eigen.'),
    ('w2', 'B · Gezeichnet', '"Girovo" gesetzt, "AI" und "API" mit den runden Strichen der Marken gezeichnet. Beim A ist der Querstrich ein Funke, bei API ein Punkt wie in den Klammern.'),
    ('w3', 'C · Kachel', 'Eine Kachel mit dem Logo wie die G€ Plakette, daneben der Name. Groß zweistufig ("GIROVO" über "AI"), klein in einer Zeile.'),
    ('w4', 'D · Eingabe', '"AI" und "API" in Girovos Monoschrift (wie die IBAN), dahinter ein Cursor. Wirkt wie etwas, das gleich antwortet.'),
]

def wpanel(d, theme):
    ai_disc = f'<span class="disc" style="background:color-mix(in srgb,var(--ai) 18%,transparent)">{g(AI_NOW, 20, color="var(--ai)")}</span>'
    api_disc = f'<span class="disc" style="background:color-mix(in srgb,var(--api) 18%,transparent)">{g(API, 20, color="var(--api)")}</span>'
    return f'''<div class="ctx {theme}"><div class="wgrid">
  <div class="c c-head">{wm(d, stacked=True)}</div>
  <div class="c c-bar">{'' if d == 'w3' else g(AI_NOW, 20, color='var(--ai)')}<span class="bt">{wm(d)}</span><span class="x">✕</span></div>
  <div class="c c-row">{ai_disc}<div><div class="t">{wm(d)}</div><div class="s">Antworten in ganzen Sätzen</div></div><span class="sw"></span></div>
  <div class="c c-ready"><div class="rt">{wm(d, rest=' ist bereit')}</div><div class="rs">Frag etwas zu deinen Umsätzen.</div></div>
  <div class="c c-api"><div class="c-head">{wm(d, 'api', stacked=True)}</div><div class="side">{api_disc}<div>{wm(d, 'api')}<i>Kommt bald</i></div></div></div>
</div></div>'''

wrows = ''.join(f'<section class="lgrid"><div class="lead"><h2>{n}</h2><p>{w}</p></div>{wpanel(d, "dark")}{wpanel(d, "light")}</section>' for d, n, w in WORDS)
open(os.path.join(HERE, 'wordmarks.html'), 'w', encoding='utf-8').write(f'''<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="brand.css"><style>body{{width:1640px}}</style></head><body>
<h1>Wortmarken für Girovo AI und Girovo API</h1><p class="intro">Je oben die Stellen von Girovo AI (Seitenkopf, Kopf des Gesprächs, Schalter, "ist bereit"), unten Girovo API (Seitenkopf, Seitenleiste). Wo ein Logo steht, ist es noch das heutige; es tauscht sich mit dem neuen Logo.</p>
<div class="lgrid"><span></span><span class="colhead">Dunkel</span><span class="colhead">Hell</span></div>{wrows}</body></html>''')

# ---------- logos ----------
LOGOS = [
    ('now', 'Heute · Strich-Funke', 'Vier Striche und zwei Diagonalen.', AI_NOW),
    ('g', 'A · G-Funke', 'Das G aus Girovos Plakette, an seinem Ende springt ein Funke ab. Klar von Girovo.',
     f'<path d="M18.2 9.6A7.4 7.4 0 1 0 19 14h-6" stroke-width="2.7"/><path d="{star(18.6, 4.6, 3.3, 0.14)}" fill="currentColor" stroke="none"/>'),
    ('bubble', 'B · Sprechblase', 'Eine runde Sprechblase mit Funken: du fragst, Girovo antwortet. Passt zum Gespräch.',
     f'<path d="M6 4h12a3.5 3.5 0 0 1 3.5 3.5v6.5a3.5 3.5 0 0 1-3.5 3.5h-6.2L7 21v-3.5H6A3.5 3.5 0 0 1 2.5 14V7.5A3.5 3.5 0 0 1 6 4z" stroke-width="2.3"/><path d="{star(12, 10.75, 4.2, 0.15)}" fill="currentColor" stroke="none"/>'),
    ('orbit', 'C · Umlauf', 'Ein Funke in der Mitte, ein Ring mit einem Punkt darum. Ruhig, rund, technisch.',
     f'<path d="M19.4 8.2A8.4 8.4 0 1 1 15.8 4.4" stroke-width="2.3"/><circle cx="18.6" cy="5.4" r="1.9" fill="currentColor" stroke="none"/><path d="{star(12, 12.4, 4.6, 0.15)}" fill="currentColor" stroke="none"/>'),
    ('facet', 'D · Facette', 'Ein Kristall von oben in vier Flächen, in Violett abgestuft. Präzise, ohne Funken.',
     '<g stroke="none" fill="currentColor"><path d="M12 2 12 12 3 12Z" opacity=".55"/><path d="M12 2 21 12 12 12Z"/><path d="M3 12 12 12 12 22Z"/><path d="M21 12 12 22 12 12Z" opacity=".7"/></g>'),
    ('euro', 'E · Euro-Funke', 'Der Bogen des € aus der Plakette, wo die Striche wären ein Funke. Geld und Antwort in einem.',
     f'<path d="M18.4 6.2A7.6 7.6 0 1 0 18.4 17.8" stroke-width="2.7"/><path d="{star(12.2, 12, 4.4, 0.14)}" fill="currentColor" stroke="none"/>'),
]

def lpanel(body, theme):
    sizes = ''.join(g(body, s) for s in (16, 20, 24, 32))
    api_c = 'var(--api)'
    return f'''<div class="ctx {theme}"><div class="lctx">
  <div class="plate">{g(body, color='#fff')}</div>
  <div class="sizes">{sizes}</div>
  <div class="pair"><div class="it"><span class="disc" style="background:color-mix(in srgb,var(--ai) 18%,transparent)">{g(body, 20, color='var(--ai)')}</span>Girovo AI</div>
    <div class="it"><span class="disc" style="background:color-mix(in srgb,var(--api) 18%,transparent)">{g(API, 20, color=api_c)}</span>Girovo API</div></div>
  <div class="ready"><span class="big">{g(body, 26, color='var(--ai)')}</span>Girovo AI ist bereit</div>
</div></div>'''

lrows = ''.join(f'<section class="lgrid"><div class="lead"><h2>{n}</h2><p>{w}</p></div>{lpanel(b, "dark")}{lpanel(b, "light")}</section>' for k, n, w, b in LOGOS)
open(os.path.join(HERE, 'logos.html'), 'w', encoding='utf-8').write(f'''<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="brand.css"><style>body{{width:1400px}}.lgrid{{grid-template-columns:240px 1fr 1fr}}</style></head><body>
<h1>Logos für Girovo AI</h1><p class="intro">Jedes auf der violetten Plakette, in den kleinen Größen, neben den Klammern von Girovo API in der Seitenleiste und in "Girovo AI ist bereit".</p>
<div class="lgrid"><span></span><span class="colhead">Dunkel</span><span class="colhead">Hell</span></div>{lrows}</body></html>''')
print('ok')
