# Writes the "Konten als Ebenen" desktop mocks (every place + Einstellungen)
# into .impeccable/mocks/desktop-shell/ from shared partials.
import io, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, '.impeccable', 'mocks', 'desktop-shell')
os.makedirs(OUT, exist_ok=True)
CSS = '../decision/desktop-shell/shell.css'
LOGOS = '../../../public/logos/'

PLATE = ('<svg class="plate" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#0a2c5e"/>'
         '<g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"><path d="M361.4 151.8A136 136 0 1 0 405.1 292H280" stroke-width="46"/>'
         '<path d="M100 222H244M100 292H208" stroke-width="40"/></g></svg>')
CAPTION = ('<div class="caption"><i><svg viewBox="0 0 10 10"><path d="M0 5.5H10"/></svg></i>'
           '<i><svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" rx="1.5"/></svg></i>'
           '<i><svg viewBox="0 0 10 10"><path d="M.5 .5L9.5 9.5M9.5 .5L.5 9.5"/></svg></i></div>')

# shared styles of the Ebenen sidebar (mini month, layers) and its ledger
EBENEN_CSS = '''
  .month{margin:16px 16px 0;padding:0 4px}
  .month-h{display:flex;align-items:center;justify-content:space-between;padding:0 0 4px 8px}
  .month-h .t{font-weight:500}
  .month-h .ib{width:32px;height:32px}
  .grid7{display:grid;grid-template-columns:repeat(7,32px);justify-content:space-between}
  .wd{height:24px;display:grid;place-items:center;font-size:12px;line-height:16px;font-weight:500;color:var(--ink-2)}
  .d{height:32px;display:grid;place-items:center;position:relative;font-size:12px;line-height:16px;font-weight:500;font-variant-numeric:tabular-nums}
  .d.out{color:var(--ink-2);opacity:.75}
  .d.today span{width:28px;height:28px;border-radius:50%;background:var(--primary);color:var(--on-primary);display:grid;place-items:center}
  .d.has::after,.d.due::after,.d.low::after{content:'';position:absolute;bottom:1px;left:50%;width:4px;height:4px;margin-left:-2px;border-radius:50%}
  .d.has::after{background:var(--ink-2)}
  .d.today.has::after{background:var(--primary)}
  .d.due::after{box-shadow:inset 0 0 0 1px var(--ink-2)}
  .d.low::after{background:var(--orange)}
  .d.band{background:var(--sc);color:var(--on-sc)}
  .d.band.s{border-radius:16px 0 0 16px}.d.band.e{border-radius:0 16px 16px 0}
  .legend{display:flex;gap:16px;padding:6px 8px 0;font-size:12px;line-height:16px;color:var(--ink-2)}
  .legend i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:1px}
  .layer{height:36px;display:flex;align-items:center;gap:12px;padding:0 16px;margin:0 12px;border-radius:18px}
  .tick{width:18px;height:18px;border-radius:4px;display:grid;place-items:center;flex:none;color:var(--sheet)}
  .tick .ms{font-size:16px;font-variation-settings:'FILL' 0,'wght' 600,'GRAD' 0,'opsz' 20}
  .tick.off{box-shadow:inset 0 0 0 2px var(--c)}
  .layer .nm{flex:1;font-weight:400}
  .layer.dim .nm,.layer.dim .num{color:var(--ink-2)}
  .layer .num{font-weight:500}
  .layer.hov{background:var(--sc1)}
  .acc{display:flex;align-items:center;gap:8px;color:var(--ink-2);white-space:nowrap}
  .acc i{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none}
'''

ACCOUNTS = [  # name, balance, layer colour
    ('GiroKomfort', '1.530,84&nbsp;€', 'var(--acc-1)'),
    ('Giro Haushalt', '1.142,52&nbsp;€', 'var(--acc-2)'),
    ('Notgroschen', '4.200,00&nbsp;€', 'var(--acc-3)'),
    ('Visa Classic', '−153,64&nbsp;€', 'var(--acc-4)'),
]


def page(name, title, body, css='', dark=False):
    html = (f'<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=1440">'
            f'<title>{title}</title>\n<link rel="stylesheet" href="{CSS}">\n<style>{EBENEN_CSS}{css}</style></head>\n'
            + ('<body class="dark">' if dark else '<body>') + f'\n{body}\n</body></html>\n')
    with io.open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)


def titlebar(search='Umsätze, Aktionen und Einstellungen suchen'):
    s = (f'<div class="search" style="width:640px"><span class="ms">search</span><span class="ph">{search}</span>'
         f'<span class="key">Strg K</span></div>') if search else ''
    return (f'<header class="titlebar"><div class="brand"><div class="ib"><span class="ms l">menu</span></div>{PLATE}'
            f'<span class="wm">Girovo</span></div>{s}<div class="tools"><div class="ib"><span class="ms">visibility</span></div>'
            f'<div class="ib"><span class="ms">notifications</span><i class="dot" style="top:9px;right:10px"></i></div>'
            f'<div class="ib"><div class="avatar">NB</div></div></div>{CAPTION}</header>')


def places(active):
    def it(key, icon, label, end=''):
        on = ' on' if key == active else ''
        e = f'<span class="end num">{end}</span>' if end else ''
        return f'<div class="item{on}"><span class="ms">{icon}</span>{label}{e}</div>'
    return ('<div class="nav">' + it('home', 'home', 'Übersicht') + it('pay', 'payments', 'Zahlungen', '3 fällig')
            + it('ana', 'bar_chart', 'Analyse') + '</div>')


def month(title, rows, legend):
    wd = ''.join(f'<div class="wd">{d}</div>' for d in ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])
    cells = ''
    for cls, txt in rows:
        inner = f'<span>{txt}</span>' if 'today' in cls else txt
        cells += f'<div class="d {cls}">{inner}</div>'
    return (f'<div class="month"><div class="month-h"><span class="t">{title}</span><span style="display:flex">'
            f'<span class="ib"><span class="ms">chevron_left</span></span><span class="ib"><span class="ms">chevron_right</span></span></span></div>'
            f'<div class="grid7">{wd}{cells}</div><div class="legend">{legend}</div></div>')


def nov(marks):
    """November 2026 from Monday 26 October; marks: {day: classes} for November days."""
    rows = [('out', str(d)) for d in range(26, 32)]
    rows += [(marks.get(d, ''), str(d)) for d in range(1, 31)]
    rows += [('out', str(d)) for d in range(1, 7)]
    return rows


def octo(marks):
    """October 2026 from Monday 28 September."""
    rows = [('out', str(d)) for d in range(28, 31)]
    rows += [(marks.get(d, ''), str(d)) for d in range(1, 32)]
    rows += [('out', str(d)) for d in range(1, 9)]
    return rows


def layers(ticked, hover=None):
    out = '<div class="sect"><span class="sub">Konten</span><span class="ib" title="Weitere Bank anmelden"><span class="ms">add</span></span></div>'
    for name, bal, c in ACCOUNTS:
        on = name in ticked
        tick = (f'<span class="tick" style="background:var(--c)"><span class="ms">check</span></span>' if on
                else '<span class="tick off"></span>')
        cls = 'layer' + ('' if on else ' dim') + (' hov' if name == hover else '')
        more = '<span class="ms" style="color:var(--ink-2);margin-right:-6px">more_vert</span>' if name == hover else ''
        out += f'<div class="{cls}" style="--c:{c}">{tick}<span class="nm trunc">{name}</span><span class="num">{bal}</span>{more}</div>'
    return out


def side(active, month_html, ticked, hover=None):
    return (f'<nav class="side" aria-label="Navigation"><div class="fab"><span class="ms">swap_horiz</span>Überweisen</div>'
            f'{places(active)}{month_html}{layers(ticked, hover)}'
            f'<div class="nav foot"><div class="item"><span class="ms">settings</span>Einstellungen</div></div></nav>')


LEG_NOV = '<span><i style="background:var(--ink-2)"></i>Umsätze</span><span><i style="box-shadow:inset 0 0 0 1px var(--ink-2)"></i>Fällig</span>'
NOV_MARKS = {1: 'has', 2: 'has', 3: 'has', 4: 'today has', 5: 'due', 15: 'due', 28: 'due', 30: 'due'}
ALL3 = {'GiroKomfort', 'Giro Haushalt', 'Visa Classic'}


def row(icon, name, meta, amount, acc=None, extra='', cls='row', amount_cls=''):
    a = f'<div class="acc" style="--c:{acc[1]}"><i></i>{acc[0]}</div>' if acc else ''
    return (f'<div class="{cls}"><div class="disc">{icon}</div><div class="nm">{name}</div><div class="meta trunc">{meta}</div>'
            f'{a}{extra}<div class="amt num {amount_cls}">{amount}</div></div>')


def ms(n, size=None):
    st = f' style="font-size:{size}px"' if size else ''
    return f'<span class="ms"{st}>{n}</span>'


GK = ('GiroKomfort', 'var(--acc-1)'); GH = ('Giro Haushalt', 'var(--acc-2)'); VC = ('Visa Classic', 'var(--acc-4)')

# ---------------------------------------------------------------- Übersicht, dark
with io.open(os.path.join(ROOT, '.impeccable', 'mocks', 'decision', 'desktop-shell', 'a-ebenen.html'), encoding='utf-8') as f:
    a = f.read()
a = a.replace('href="shell.css"', f'href="{CSS}"').replace('<body>', '<body class="dark">')
a = a.replace('.d.out{color:#5f6672}', '.d.out{color:var(--ink-2);opacity:.75}').replace('color:#fff}', 'color:var(--sheet)}')
a = a.replace('<title>Konten als Ebenen – Desktop</title>', '<title>Übersicht, dunkel – Desktop</title>')
with io.open(os.path.join(OUT, '1-uebersicht-dunkel.html'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(a)

# ---------------------------------------------------------------- an account on its own
konto = titlebar('In GiroKomfort suchen') + side('home', month('November 2026', nov(NOV_MARKS), LEG_NOV), {'GiroKomfort'})
konto += '''<main class="sheet ledger">
  <div style="display:flex;align-items:flex-end;justify-content:space-between;padding:22px 28px 0">
    <div>
      <div class="sub">Nur dieses Konto · <span style="color:var(--primary)">Alle Konten zeigen</span></div>
      <div style="font-size:22px;line-height:28px;font-weight:500;margin-top:6px">GiroKomfort</div>
      <div class="meta" style="white-space:nowrap">Volksbank Musterstadt eG · <span class="mono">DE89 5509 9999 0105 5932 71</span></div>
      <div class="lead" style="margin-top:6px">1.530<span class="c">,84&nbsp;€</span></div>
      <div class="meta">Verfügbar <span class="num" style="color:var(--ink);font-weight:500">3.457,46&nbsp;€</span> · Stand <span class="num" style="letter-spacing:0">14:56</span> Uhr</div>
    </div>
    <div style="display:flex;gap:40px;align-items:flex-end;padding-bottom:2px">
      <div class="fig"><div class="l" style="white-space:nowrap">Eingänge November</div><div class="v num">0,00&nbsp;€</div></div>
      <div class="fig"><div class="l" style="white-space:nowrap">Ausgänge November</div><div class="v num">−107,84&nbsp;€</div></div>
      <svg width="132" height="52" viewBox="0 0 132 52" aria-hidden="true" style="margin-bottom:-4px"><title>Kontoverlauf</title>
        <path d="M2 40H22V36H40V18H58V22H76V20H92V12H110V16H130V50H2Z" fill="var(--primary)" fill-opacity=".12"/>
        <path d="M2 40H22V36H40V18H58V22H76V20H92V12H110V16H130" fill="none" stroke="var(--primary)" stroke-width="2"/>
        <circle cx="130" cy="16" r="3.5" fill="var(--primary)"/></svg>
    </div>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px 10px 28px">
    <div class="chips">
      <div class="chip tr"><span class="amb"></span>Vorgemerkt <span class="num">2</span><span class="ms">expand_more</span></div>
      <div class="chip">Eingänge</div><div class="chip">Ausgänge</div>
      <div class="chip tr">Kategorie<span class="ms">expand_more</span></div>
    </div>
    <div style="display:flex;align-items:center;gap:4px">
      <div class="chip tr" style="padding-left:10px"><span class="ms">calendar_month</span>November<span class="ms">expand_more</span></div>
      <div class="ib"><span class="ms">refresh</span></div><div class="ib"><span class="ms">download</span></div>
    </div>
  </div>'''
konto += '<div class="day"><span><span class="ms">schedule</span>Morgen · noch nicht gebucht</span></div>'
konto += row(ms('directions_car'), 'Aral Station 4711', 'Mobilität · girocard · Musterstadt', '−64,18&nbsp;€')
konto += '<div class="day"><span>Vorgemerkt</span></div>'
konto += row(ms('local_mall'), 'Kaufland Musterstadt', 'Lebensmittel &amp; Drogerie · girocard', '−41,27&nbsp;€', cls='row').replace('<div class="disc">', '<div class="disc amber">', 1)
konto += row(ms('local_gas_station'), 'Shell Deutschland', 'Mobilität · girocard', '−58,00&nbsp;€').replace('<div class="disc">', '<div class="disc amber">', 1)
konto += '<div class="day"><span>Heute</span><span>Kontostand 1.530,84&nbsp;€</span></div>'
konto += row(ms('smartphone'), 'Telekom Deutschland GmbH', 'Abos &amp; Medien · Kd-Nr. 6113 4401 22 RG 11/2026 Mobilfunk', '−39,95&nbsp;€', cls='row new')
konto += row(ms('shopping_bag'), 'Zalando SE', 'Shopping · über PayPal', '−33,52&nbsp;€', cls='row new')
konto += '<div class="day"><span>Gestern</span><span>Kontostand 1.604,31&nbsp;€</span></div>'
konto += row(ms('restaurant'), 'Cafe Extrablatt', 'Essen &amp; Trinken · girocard · Musterstadt', '−23,61&nbsp;€')
konto += row(ms('shopping_basket'), 'DM-Drogerie Markt', 'Lebensmittel &amp; Drogerie · girocard', '−10,76&nbsp;€')
konto += '<div class="day"><span>Freitag, 30. Oktober</span><span>Kontostand 1.638,68&nbsp;€</span></div>'
konto += row(ms('work'), 'Rheintal Software GmbH', 'Einkommen · Gehalt Oktober', '+2.840,00&nbsp;€', amount_cls='pos')
konto += '</main>'
page('2-konto.html', 'Ein Konto allein – Desktop', titlebar('In GiroKomfort suchen') and konto,
     css='.ledger .row{grid-template-columns:32px minmax(0,300px) minmax(0,1fr) 112px}')

# ---------------------------------------------------------------- Zahlungen
pay_marks = {4: 'today has', 15: 'due', 25: 'due', 28: 'due', 29: 'low', 30: 'due'}
LEG_PAY = ('<span><i style="box-shadow:inset 0 0 0 1px var(--ink-2)"></i>Fällig</span>'
           '<span><i style="background:var(--orange)"></i>Tiefster Stand</span>')
zah = titlebar('Empfänger, Vorlagen und Aufträge suchen') + side('pay', month('November 2026', nov(pay_marks), LEG_PAY), ALL3)
zah += '''<main class="sheet">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 24px 0 28px">
    <span style="font-size:22px;line-height:28px;font-weight:500">Zahlungen</span>
    <span style="display:flex;gap:8px"><span class="btn tonal"><span class="ms">qr_code_2</span>Geld anfordern</span><span class="btn tonal"><span class="ms">description</span>Rechnung öffnen</span></span>
  </div>
  <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:40px;padding:12px 28px 0">
    <section>
      <div class="sub" style="padding:12px 0 4px">Vorlagen</div>
      <div class="prow"><div class="disc">''' + ms('star') + '''</div><div><div class="nm">Taschengeld Lea</div><div class="meta">Lea Becker · <span class="mono">DE12 ··· 4898 90</span></div></div><div class="amt num">25,00&nbsp;€</div></div>
      <div class="prow hov"><div class="disc">''' + ms('star') + '''</div><div><div class="nm">Garage Kraemer</div><div class="meta">Hausverwaltung Kraemer GmbH · <span class="mono">DE75 ··· 1261 99</span></div></div><div style="display:flex;align-items:center;gap:4px"><span class="btn text" style="padding:0 10px">Überweisen</span><span class="amt num">80,00&nbsp;€</span></div></div>
      <div class="sub" style="padding:20px 0 4px">Zuletzt bezahlt</div>
      <div class="prow"><div class="disc ini">LB</div><div><div class="nm">Lea Becker</div><div class="meta">vor 3 Tagen · Taschengeld November</div></div><div class="amt num">25,00&nbsp;€</div></div>
      <div class="prow"><div class="disc ini">HK</div><div><div class="nm">Hausverwaltung Kraemer GmbH</div><div class="meta">2. November · Miete November</div></div><div class="amt num">1.090,00&nbsp;€</div></div>
      <div class="prow"><div class="disc ini">SM</div><div><div class="nm">Stadtwerke Musterstadt</div><div class="meta">28. Oktober · Abschlag Strom</div></div><div class="amt num">86,00&nbsp;€</div></div>
      <div class="prow"><div class="disc ini">JW</div><div><div class="nm">Jonas Weber</div><div class="meta">20. Oktober · Konzertkarten</div></div><div class="amt num">42,50&nbsp;€</div></div>
      <div class="hairline" style="margin:16px 0 8px"></div>
      <div class="prow"><div class="disc">''' + ms('repeat') + '''</div><div><div class="nm">Daueraufträge und Terminüberweisungen</div><div class="meta">3 Daueraufträge · 1 Terminüberweisung</div></div><span class="ms" style="color:var(--ink-2)">chevron_right</span></div>
      <div class="prow"><div class="disc">''' + ms('receipt_long') + '''</div><div><div class="nm">Verträge &amp; Abos</div><div class="meta">12 erkannt · Fixkosten pro Jahr mind. 15.790&nbsp;€</div></div><span class="ms" style="color:var(--ink-2)">chevron_right</span></div>
    </section>
    <section>
      <div class="sub" style="padding:12px 0 4px">Kontostand Ende November</div>
      <div style="display:flex;align-items:baseline;gap:10px"><span class="meta" style="font-size:16px">ca.</span><span class="lead">3.075&nbsp;€</span><span class="meta">GiroKomfort · Prognose</span></div>
      <svg width="100%" height="128" viewBox="0 0 560 128" preserveAspectRatio="none" aria-hidden="true" style="display:block;margin-top:12px">
        <line x1="0" y1="92" x2="560" y2="92" stroke="var(--ov)" stroke-dasharray="3 4"/>
        <path d="M0 52H20V54H96V60H186V61H366V70H396V72H474V100H508V22H560V128H0Z" fill="var(--primary)" fill-opacity=".12"/>
        <path d="M0 52H20V54H96V60H186V61H366V70H396V72H474V100H508V22H560" fill="none" stroke="var(--primary)" stroke-width="2"/>
        <circle cx="490" cy="100" r="4" fill="var(--orange)"/>
      </svg>
      <div style="display:flex;justify-content:space-between" class="meta"><span>Heute</span><span>15.</span><span>30. November</span></div>
      <div class="warn"><span class="ms" style="color:var(--orange)">warning</span><span>Am 29.11. könnte das Konto ins Minus rutschen – auf ca. −62&nbsp;€. Im Dispo fallen Sollzinsen an.</span></div>
      <div class="sub" style="padding:20px 0 4px">Demnächst fällig</div>
      <div class="drow"><span class="meta num">15.11.</span><span class="nm">Sparrate Notgroschen</span><span class="meta">Dauerauftrag</span><span class="amt num">−150,00&nbsp;€</span></div>
      <div class="drow"><span class="meta num">25.11.</span><span class="nm">Taschengeld Lea</span><span class="meta">Dauerauftrag</span><span class="amt num">−25,00&nbsp;€</span></div>
      <div class="drow"><span class="meta num">28.11.</span><span class="nm">Telekom Deutschland GmbH</span><span class="meta">Lastschrift, erwartet</span><span class="amt num">−39,95&nbsp;€</span></div>
      <div class="drow"><span class="meta num">28.11.</span><span class="nm">Stadtwerke Musterstadt</span><span class="meta">Abschlag, erwartet</span><span class="amt num">−86,00&nbsp;€</span></div>
      <div class="drow"><span class="meta num">30.11.</span><span class="nm">Rheintal Software GmbH</span><span class="meta">Gehalt, erwartet</span><span class="amt num pos">+2.840,00&nbsp;€</span></div>
    </section>
  </div>
</main>'''
page('3-zahlungen.html', 'Zahlungen – Desktop', zah, css='''
  .prow{height:56px;display:grid;grid-template-columns:32px minmax(0,1fr) auto;column-gap:16px;align-items:center;padding:0 12px;margin:0 -12px;border-radius:12px}
  .prow.hov{background:var(--sc1)}
  .prow>div:nth-child(2){min-width:0}
  .prow .meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .disc.ini{font-size:12px;line-height:16px;font-weight:500;letter-spacing:.02em}
  .warn{display:flex;gap:12px;align-items:flex-start;margin-top:14px;padding:12px 16px;border-radius:12px;background:var(--sc1)}
  .drow{height:40px;display:grid;grid-template-columns:52px minmax(0,1fr) 150px 104px;column-gap:12px;align-items:center}
''')

# ---------------------------------------------------------------- Analyse
ana_marks = {d: 'band' for d in range(1, 32)}
ana_marks[1] = 'band s'; ana_marks[31] = 'band e'
LEG_ANA = '<span>Ganzer Monat · ziehen wählt Tage</span>'
cats = [('home', 'Wohnen &amp; Energie', '1.238,00', '41 % · 2 Umsätze', 41, 'var(--c1)'),
        ('shopping_basket', 'Lebensmittel &amp; Drogerie', '527,48', '17 % · 17 Umsätze', 17, 'var(--c2)'),
        ('health_and_safety', 'Versicherungen', '524,91', '17 % · 2 Umsätze', 17, 'var(--c3)'),
        ('restaurant', 'Essen &amp; Trinken', '189,98', '6 % · 12 Umsätze', 6, 'var(--c4)'),
        ('shopping_bag', 'Shopping', '165,64', '5 % · 5 Umsätze', 5, 'var(--c5)'),
        ('directions_car', 'Mobilität', '162,14', '5 % · 3 Umsätze', 5, 'var(--c6)'),
        ('more_horiz', 'Übrige', '224,83', '7 % · 9 Umsätze', 7, 'var(--crest)')]
stack = ''.join(f'<i style="flex:{p};background:{c}"></i>' for _, _, _, _, p, c in cats)
crows = ''.join(f'<div class="crow"><div class="disc">{ms(i)}</div><div><div class="nm">{n}</div><div class="cbar"><i style="width:{p * 2.2:.0f}%;background:{c}"></i></div></div>'
                f'<div style="text-align:right"><div class="amt num">{v}&nbsp;€</div><div class="meta num">{m}</div></div></div>' for i, n, v, m, p, c in cats)
ana = titlebar('Kategorien und Empfänger suchen') + side('ana', month('Oktober 2026', octo(ana_marks), LEG_ANA), ALL3)
ana += f'''<main class="sheet">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 24px 0 28px">
    <div style="display:flex;align-items:center;gap:4px"><span class="ib"><span class="ms">chevron_left</span></span><span style="font-size:22px;line-height:28px;font-weight:500;margin:0 6px">Oktober 2026</span><span class="ib"><span class="ms">chevron_right</span></span></div>
    <span style="display:flex;align-items:center;gap:4px"><span class="btn text">Budgets festlegen</span><span class="ib"><span class="ms">download</span></span></span>
  </div>
  <div class="meta" style="padding:2px 28px 0">3 Konten · 48 Umsätze · 2 Umbuchungen zwischen deinen Konten nicht mitgezählt</div>
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));column-gap:24px;padding:20px 28px 0">
    <div class="fig"><div class="l">Einnahmen</div><div class="lead2 num">3.197,09&nbsp;€</div></div>
    <div class="fig"><div class="l">Ausgaben</div><div class="lead2 num">3.032,98&nbsp;€</div><div class="meta">18 % mehr als im September</div></div>
    <div class="fig"><div class="l">Differenz</div><div class="lead2 num pos">+164,11&nbsp;€</div></div>
    <div class="fig"><div class="l">Ø Ausgaben pro Monat</div><div class="lead2 num">2.797,51&nbsp;€</div><div class="meta">aus 2 vollen Monaten</div></div>
  </div>
  <div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);column-gap:44px;padding:24px 28px 0">
    <section>
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="sect2">Ausgaben nach Kategorie</span></div>
      <div class="stack">{stack}</div>
      {crows}
    </section>
    <section>
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="sect2">Monatsvergleich</span><span class="btn text" style="padding:0">Als Tabelle</span></div>
      <div class="legend2"><span><i style="background:var(--cin)"></i>Einnahmen</span><span><i style="background:var(--cout)"></i>Ausgaben</span><span><i style="box-shadow:inset 0 0 0 1.5px var(--ink-2)"></i>Unvollständig</span></div>
      <svg width="100%" height="188" viewBox="0 0 480 188" aria-hidden="true" style="display:block">
        <g stroke="var(--hair)"><line x1="40" y1="20" x2="480" y2="20"/><line x1="40" y1="62" x2="480" y2="62"/><line x1="40" y1="104" x2="480" y2="104"/><line x1="40" y1="146" x2="480" y2="146"/></g>
        <g font-size="12" fill="var(--ink-2)" font-family="Google Sans Flex" text-anchor="end"><text x="32" y="24">3.000</text><text x="32" y="66">2.000</text><text x="32" y="108">1.000</text><text x="32" y="150">0 €</text></g>
        <rect x="64" y="12" width="26" height="134" rx="4" fill="var(--cin)" opacity=".55"/><rect x="94" y="110" width="26" height="36" rx="4" fill="var(--cout)" opacity=".55"/>
        <rect x="174" y="14" width="26" height="132" rx="4" fill="var(--cin)" opacity=".55"/><rect x="204" y="40" width="26" height="106" rx="4" fill="var(--cout)" opacity=".55"/>
        <rect x="284" y="12" width="26" height="134" rx="4" fill="var(--cin)"/><rect x="314" y="19" width="26" height="127" rx="4" fill="var(--cout)"/>
        <rect x="394" y="142" width="26" height="4" rx="2" fill="none" stroke="var(--ink-2)" stroke-width="1.5"/><rect x="424.75" y="94.75" width="24.5" height="50.5" rx="4" fill="none" stroke="var(--ink-2)" stroke-width="1.5"/>
        <g font-size="12" fill="var(--ink-2)" font-family="Google Sans Flex" text-anchor="middle"><text x="92" y="168">Aug</text><text x="202" y="168">Sep</text><text x="312" y="168" fill="var(--ink)" font-weight="500">Okt</text><text x="422" y="168">Nov</text></g>
      </svg>
      <div class="sect2" style="margin-top:14px">Top-Empfänger</div>
      <div class="trow"><div class="disc ini">HK</div><div><div class="nm">Hausverwaltung Kraemer GmbH</div><div class="meta">1 Umsatz · Wohnen &amp; Energie</div></div><div class="amt num">1.090,00&nbsp;€</div></div>
      <div class="trow"><div class="disc">{ms('shopping_basket')}</div><div><div class="nm">REWE Markt</div><div class="meta">9 Umsätze · Lebensmittel &amp; Drogerie</div></div><div class="amt num">312,40&nbsp;€</div></div>
      <div class="trow"><div class="disc">{ms('health_and_safety')}</div><div><div class="nm">Allianz Versicherungs-AG</div><div class="meta">1 Umsatz · Versicherungen</div></div><div class="amt num">289,00&nbsp;€</div></div>
    </section>
  </div>
</main>'''
page('4-analyse.html', 'Analyse – Desktop', ana, css='''
  body{--c1:#0053a4;--c2:#0ca4a0;--c3:#5f38a7;--c4:#e968a1;--c5:#3846b1;--c6:#049cd1;--crest:#8a96a3;--cin:#2a9a5a;--cout:#30588f}
  .lead2{font-size:28px;line-height:36px;font-weight:500;letter-spacing:-0.025em}
  .sect2{font-size:18px;line-height:24px;font-weight:500}
  .stack{display:flex;gap:2px;height:12px;border-radius:6px;overflow:hidden;margin:14px 0 8px}
  .crow{height:52px;display:grid;grid-template-columns:32px minmax(0,1fr) 150px;column-gap:16px;align-items:center}
  .cbar{height:6px;margin-top:6px;border-radius:3px;background:var(--sc1);overflow:hidden}.cbar i{display:block;height:100%;border-radius:3px}
  .legend2{display:flex;gap:16px;margin:10px 0 4px;font-size:12px;line-height:16px;color:var(--ink-2)}
  .legend2 i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
  .trow{height:52px;display:grid;grid-template-columns:32px minmax(0,1fr) auto;column-gap:16px;align-items:center}
  .disc.ini{font-size:12px;line-height:16px;font-weight:500;letter-spacing:.02em}
''')

# ---------------------------------------------------------------- Einstellungen
sections = [('tune', 'Allgemein', True), ('shield', 'Sicherheit', False), ('devices', 'Geräte', False), ('label', 'Kategorien', False),
            ('account_balance', 'Banken &amp; Konten', False), ('lock', 'Datenschutz', False), ('info', 'Über Girovo', False)]
snav = ''.join(f'<div class="item{" on" if on else ""}"><span class="ms">{i}</span>{n}</div>' for i, n, on in sections)
ein = titlebar('Einstellungen suchen')
ein += f'''<nav class="side" aria-label="Einstellungen">
  <div style="display:flex;align-items:center;gap:8px;padding:4px 16px 16px 12px"><span class="ib"><span class="ms l">arrow_back</span></span><span style="font-size:22px;line-height:28px;font-weight:500">Einstellungen</span></div>
  <div class="nav">{snav}</div>
</nav>
<main class="sheet" style="padding:28px 48px 0">
  <div style="max-width:760px">
    <div style="font-size:22px;line-height:28px;font-weight:500">Allgemein</div>
    <div class="group" style="margin-top:20px">
      <div class="srow"><span class="ms">language</span><div><div class="nm">Sprache</div></div><div class="seg"><span class="on">Deutsch</span><span>English</span></div></div>
      <div class="srow"><span class="ms">contrast</span><div><div class="nm">Darstellung</div></div><div class="seg"><span><span class="ms" style="font-size:16px">light_mode</span>Hell</span><span><span class="ms" style="font-size:16px">dark_mode</span>Dunkel</span><span class="on"><span class="ms" style="font-size:16px">computer</span>System</span></div></div>
      <div class="srow"><span class="ms">timer</span><div><div class="nm">Automatisch abmelden</div><div class="meta">Eine Minute vorher fragt Girovo nach – während einer Freigabe nie.</div></div><div class="sel">10 Min<span class="ms">expand_more</span></div></div>
      <div class="srow"><span class="ms">refresh</span><div><div class="nm">Salden beim Anmelden abrufen</div><div class="meta">Nach der Anmeldung liest Girovo jeden Saldo – das kann eine Freigabe erfordern.</div></div><span class="sw"></span></div>
      <div class="srow"><span class="ms">keyboard</span><div><div class="nm">Tastenkürzel</div><div class="meta">Strg K sucht, N überweist, Alt+1–3 wechselt den Bereich, ? zeigt alle.</div></div><span class="ms" style="color:var(--ink-2)">chevron_right</span></div>
    </div>
    <div class="sub" style="color:var(--primary);padding:28px 0 8px 4px">Windows</div>
    <div class="group">
      <div class="srow"><span class="ms">notifications_active</span><div><div class="nm">Neue Umsätze melden</div><div class="meta">Alle sechs Stunden sieht Girovo bei deinen Banken nach und meldet neue Umsätze.</div></div><span class="sw on"></span></div>
      <div class="srow"><span class="ms">rocket_launch</span><div><div class="nm">Mit Windows starten</div><div class="meta">Unsichtbar im Infobereich, damit die Meldungen auch ohne Fenster kommen.</div></div><span class="sw on"></span></div>
      <div class="srow"><span class="ms">face</span><div><div class="nm">Mit Windows Hello anmelden</div><div class="meta">Gesicht, Finger oder deine Windows-PIN statt deiner PIN für die Volksbank.</div></div><span class="sw"></span></div>
    </div>
  </div>
</main>'''
page('5-einstellungen.html', 'Einstellungen – Desktop', ein, css='''
  .group{display:flex;flex-direction:column;gap:2px;border-radius:20px;overflow:hidden}
  .srow{min-height:64px;display:grid;grid-template-columns:24px minmax(0,1fr) auto;column-gap:20px;align-items:center;padding:10px 20px;background:var(--sc1);border-radius:4px}
  .srow>.ms{color:var(--ink-2)}
  .seg{display:flex;height:36px;border-radius:18px;box-shadow:inset 0 0 0 1px var(--ov);overflow:hidden}
  .seg>span{display:flex;align-items:center;gap:6px;padding:0 14px;font-weight:500;color:var(--ink-2)}
  .seg>span+span{box-shadow:-1px 0 0 var(--ov)}
  .seg .on{background:var(--sc);color:var(--on-sc)}
  .sel{display:flex;align-items:center;gap:4px;font-weight:500;color:var(--ink-2)}
  .sw{width:52px;height:32px;border-radius:16px;box-shadow:inset 0 0 0 2px var(--outline);position:relative;flex:none}
  .sw::after{content:'';position:absolute;left:8px;top:8px;width:16px;height:16px;border-radius:50%;background:var(--outline)}
  .sw.on{background:var(--primary);box-shadow:none}
  .sw.on::after{left:24px;top:4px;width:24px;height:24px;background:var(--on-primary)}
''')
print('written:', sorted(os.listdir(OUT)))
