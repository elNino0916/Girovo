# Writes board.html: four ways to lay out Einstellungen -> Girovo AI on the
# desktop (components/settings/AskSettings.tsx), each in light (model loaded,
# Girovo AI on) and dark (model not loaded yet, the owner's screenshot).
# Render: msedge --headless=new --screenshot=board.png --window-size=1760,H board.html
import os

HERE = os.path.dirname(os.path.abspath(__file__))

MARK = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" style="color:var(--ai)">'
        '<path d="M12 1.8v6.6M12 15.6v6.6M3.4 12h5.4M15.2 12h5.4" stroke-width="2.9"/>'
        '<path d="M16.6 5.4l-1.5 1.5M7.4 18.6l1.5-1.5" stroke-width="2.4"/></svg>')
WORDMARK = '<span class="wm">Girovo <b>AI</b></span>'
PRIVATE = 'Deine Fragen und Umsätze verlassen nie dein Gerät.'
NEEDS = 'Geht, sobald das Modell geladen ist.'


def ms(name, extra=''):
    return f'<span class="ms" {extra}>{name}</span>'


def sw(on, dis=False):
    return f'<span class="sw{" on" if on else ""}{" dis" if dis else ""}"></span>'


def row(icon, title, sub=None, end='', off=False, below=None, cls=''):
    s = f'<div class="s">{sub}</div>' if sub else ''
    b = f'<div class="b">{below}</div>' if below else ''
    return (f'<div class="row{" off" if off else ""} {cls}"><span class="g">{icon}</span>'
            f'<div class="rt"><div class="t">{title}</div>{s}{b}</div>'
            f'<span class="end">{end}</span></div>')


def group(rows, title=None, note=None, lock=False):
    t = f'<div class="gt">{title}</div>' if title else ''
    n = ''
    if note:
        n = (f'<div class="note lock">{ms("lock")}<span>{note}</span></div>' if lock
             else f'<div class="note">{note}</div>')
    return f'<section>{t}<div class="grp">{"".join(rows)}</div>{n}</section>'


def head():
    return f'<h3 class="ph">{WORDMARK}</h3>'


def ask_row(ready, on=True, sub_off='Antworten in ganzen Sätzen', cls=''):
    return row(MARK, 'Girovo AI verwenden', 'Antworten in ganzen Sätzen' if ready else sub_off,
               sw(on and ready, not ready), off=not ready, cls=cls)


def names_row(ready):
    return row(ms('sell'), 'Namen mit Girovo AI aufräumen', 'Zeigt Rewe statt REWE MARKT GMBH 4711',
               sw(ready, not ready), off=not ready)


def cat_row(ready):
    return row(MARK, 'Mit Girovo AI kategorisieren', '12 Ausgaben in Sonstiges',
               ms('chevron_right', 'style="color:var(--ink2);font-size:20px"') if ready else '', off=not ready)


def model_row(ready):
    if ready:
        return row(ms('check_circle', 'style="color:var(--ok)"'), 'Sprachmodell', 'Bereit',
                   '<span class="btn text sm">Löschen</span>')
    return row(ms('download'), 'Sprachmodell', 'Etwa 3,4 GB', '<span class="btn tonal sm">Laden</span>',
               below='Lädt einmal von Hugging Face und GitHub.')


# ---- A · Modell zuerst ------------------------------------------------------------
def a(ready):
    return head() + '<div class="page">' + group([model_row(ready)], note=PRIVATE, lock=True) + group(
        [ask_row(ready), names_row(ready), cat_row(ready)], title='Funktionen',
        note=None if ready else NEEDS) + '</div>'


# ---- B · Hauptschalter ------------------------------------------------------------
def b(ready):
    main = (f'<div class="main{" on" if ready else " dis"}"><span class="t">Girovo AI verwenden</span>{sw(ready, not ready)}</div>'
            f'<div class="below"><div class="l">{ms("lock")}{PRIVATE}</div></div>')
    if not ready:
        main = (f'<div class="main dis"><span class="t">Girovo AI verwenden</span>{sw(False, True)}</div>'
                f'<div class="below"><div class="l">{ms("info")}Geht, sobald das Modell unten geladen ist.</div>'
                f'<div class="l">{ms("lock")}{PRIVATE}</div></div>')
    return head() + '<div class="page"><section>' + main + '</section>' + group(
        [model_row(ready)], title='Sprachmodell') + group(
        [names_row(ready), cat_row(ready)], title='Funktionen') + '</div>'


# ---- C · Einrichtung --------------------------------------------------------------
def c(ready):
    if ready:
        return head() + '<div class="page">' + group(
            [ask_row(True), names_row(True), cat_row(True)], note=PRIVATE, lock=True) + group(
            [model_row(True)], title='Sprachmodell') + '</div>'
    card = (f'<div class="setup"><span class="disc">{MARK}</span><h3>Sprachmodell laden</h3>'
            f'<p>Etwa 3,4 GB. Lädt einmal von Hugging Face und GitHub.</p>'
            f'<span class="btn primary">{ms("download")}Laden</span>'
            f'<div class="lockline">{ms("lock")}{PRIVATE}</div></div>')
    return head() + '<div class="page"><section>' + card + '</section>' + group(
        [ask_row(False), names_row(False), cat_row(False)], title='Danach', note=NEEDS) + '</div>'


# ---- D · Ruhig --------------------------------------------------------------------
def d(ready):
    return head() + '<div class="page">' + group(
        [ask_row(ready, sub_off='Lade zuerst das Modell unten'), names_row(ready), cat_row(ready)],
        note=PRIVATE, lock=True) + group([model_row(ready)], title='Antworten') + '</div>'


DIRS = [
    ('A · Modell zuerst', 'A plain settings list in the order you need it: the model on top, the privacy sentence as a quiet line under it, then the three switches under "Funktionen". No violet wash, no card that looks like a setting.', 'Stays the same once loaded; the model row then says Bereit with Löschen.', a),
    ('B · Hauptschalter', 'Android\'s main switch: one large pill "Girovo AI verwenden" heads the page, violet when on, grey while it cannot turn on. Two short lines under it say why and what stays private. Model and features in their own groups.', 'The pill is the one violet surface on the page.', b),
    ('C · Einrichtung', 'Before the model is here the page is one setup card: the mark, the size, one Laden button, the privacy sentence. The switches wait dimmed below it. Once loaded the card goes and the page is a plain list with the model at the end.', 'Two layouts: setup, then settings.', c),
    ('D · Ruhig', 'Today\'s order, cleaned up: the switches and Kategorisieren in one group, the privacy sentence as that group\'s note, the model at the end under "Antworten". No wash, the switch renamed so the wordmark stands once.', 'Smallest change from what ships now.', d),
]

out = ''
for name, why, state, fn in DIRS:
    out += (f'<div class="dir"><div><h2>{name}</h2><p class="why">{why}</p><p class="state">{state}</p></div>'
            f'<div class="theme light">{fn(True)}</div><div class="theme dark">{fn(False)}</div></div>')

src = open(os.path.join(HERE, 'board.tpl.html'), encoding='utf-8').read()
open(os.path.join(HERE, 'board.html'), 'w', encoding='utf-8').write(src.replace('TEMPLATE', out))
print('ok')
