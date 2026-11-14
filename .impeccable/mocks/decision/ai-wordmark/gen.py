# Girovo AI's name as a wordmark: four directions, each shown where the name is a title. Mock only.
import os
HERE = os.path.dirname(os.path.abspath(__file__))

MARK = '<svg class="mk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M12 2.6v6.2M12 15.2v6.2M2.6 12h6.2M15.2 12h6.2" stroke-width="2.7"/><path d="M17.4 4.6l-1.9 1.9M6.6 17.4l1.9-1.9" stroke-width="2.2" opacity=".55"/></svg>'
SPARK = '<svg class="spk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M12 3v7M12 14v7M3 12h7M14 12h7" stroke-width="3.4"/></svg>'

def wm(k, rest=''):
    """The wordmark of direction k, optionally followed by plain words ("ist bereit")."""
    tail = f'<span class="rest">{rest}</span>' if rest else ''
    if k == 'a':
        return f'<span class="wm wm-a"><span class="g">Girovo</span> <span class="ai">AI</span>{tail}</span>'
    if k == 'b':
        return f'<span class="wm wm-b"><span class="g">Girovo</span><span class="ai">AI</span>{tail}</span>'
    if k == 'c':
        return f'<span class="wm wm-c"><span class="g">Girovo</span><span class="ai">AI</span>{tail}</span>'
    if k == 'd':
        return f'<span class="wm wm-d"><span class="g">Girovo</span> <span class="ai">A<span class="i">I{SPARK}</span></span>{tail}</span>'
    return f'<span class="wm">Girovo AI{tail}</span>'

DIRS = [
    ('a', 'A · Zweifarbig', '"Girovo" in der Schrift der App, "AI" kräftiger in Violett. Wie "Girovo Next" im Titel.'),
    ('b', 'B · Plakette', '"AI" sitzt in einer kleinen violetten Plakette direkt hinter "Girovo". Liest sich wie ein Abzeichen, auch ganz klein.'),
    ('c', 'C · Breit', '"Girovo" leicht, "AI" breit und fett aus der variablen Schrift, in Violett. Am eigensten, ohne neue Formen.'),
    ('d', 'D · Funke', 'Wie A, aber das "I" trägt oben den Funken aus der AI-Marke. Die Marke steckt im Namen selbst.'),
]

def panel(k, theme):
    return f'''<div class="ctx {theme}">
  <div class="c c-head">{wm(k)}</div>
  <div class="c c-row"><span class="mkwrap">{MARK}</span><div><div class="t">{wm(k)}</div><div class="s">Antworten in ganzen Sätzen</div></div><span class="sw"></span></div>
  <div class="c c-bar"><span class="mkwrap sm">{MARK}</span><span class="bt">{wm(k)}</span><span class="x">✕</span></div>
  <div class="c c-ready"><span class="disc">{MARK}</span><div class="rt">{wm(k, ' ist bereit')}</div><div class="rs">Frag etwas zu deinen Umsätzen.</div></div>
</div>'''

rows = ''.join(f'''<section><div class="lead"><h2>{name}</h2><p>{why}</p></div>{panel(k, 'dark')}{panel(k, 'light')}</section>''' for k, name, why in DIRS)
html = f'''<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="wm.css"></head><body>
<h1>Girovo AI als Wortmarke</h1><p class="intro">Nur wo der Name ein Titel ist: Seitenkopf, Schalter, Kopf des Gesprächs, "Girovo AI ist bereit", die Plus-Liste. In Sätzen bleibt er normaler Text.</p>
<div class="cols"><span></span><span>Dunkel</span><span>Hell</span></div>
<div class="cols base"><div class="lead"><h2>Heute</h2><p>Reiner Text.</p></div>{panel('x', 'dark')}{panel('x', 'light')}</div>
{rows}</body></html>'''
open(os.path.join(HERE, 'board.html'), 'w', encoding='utf-8').write(html)
print('ok')
