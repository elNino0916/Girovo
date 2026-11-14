# Girovo API's icon next to Girovo AI's in the settings sidebar: options that do not share the AI mark's four arms. Mock only.
import os
HERE = os.path.dirname(os.path.abspath(__file__))
AI = '<path d="M12 2.6v6.2M12 15.2v6.2M2.6 12h6.2M15.2 12h6.2" stroke-width="2.7"/><path d="M17.4 4.6l-1.9 1.9M6.6 17.4l1.9-1.9" stroke-width="2.2" opacity=".55"/>'
APIS = [
    ('now', 'Heute · Knoten', 'Vier Arme wie die AI-Marke: zu ähnlich.',
     '<path d="M12 9.4V7.4M14.6 12h2M12 14.6v2M9.4 12h-2" stroke-width="2.7"/><g fill="currentColor" stroke="none"><circle cx="12" cy="3.5" r="2.3"/><circle cx="20.5" cy="12" r="2.3"/><circle cx="12" cy="20.5" r="2.3"/><circle cx="3.5" cy="12" r="2.3"/></g>'),
    ('a', 'A · Klammern', 'Das Zeichen für Code. Sofort klar, ganz andere Form.',
     '<path d="M8.6 6.2 3.4 12l5.2 5.8" stroke-width="2.7"/><path d="M15.4 6.2 20.6 12l-5.2 5.8" stroke-width="2.7"/><circle fill="currentColor" stroke="none" cx="12" cy="12" r="1.7"/>'),
    ('b', 'B · Stecker', 'Ein Stecker: du schließt etwas an Girovo an.',
     '<path d="M9 2.8v4.4M15 2.8v4.4" stroke-width="2.7"/><path d="M6.2 7.6h11.6v2.9a5.8 5.8 0 0 1-11.6 0z" stroke-width="2.4"/><path d="M12 16.3v4.9" stroke-width="2.7"/>'),
    ('c', 'C · Glied', 'Zwei Kettenglieder: Girovo verbunden mit einer anderen App.',
     '<path d="M10.4 13.6a3.9 3.9 0 0 1 0-5.5l2.4-2.4a3.9 3.9 0 0 1 5.5 5.5l-1.2 1.2" stroke-width="2.6"/><path d="M13.6 10.4a3.9 3.9 0 0 1 0 5.5l-2.4 2.4a3.9 3.9 0 0 1-5.5-5.5l1.2-1.2" stroke-width="2.6" opacity=".6"/>'),
    ('d', 'D · Eingabe', 'Ein Fenster mit Eingabezeile: Befehle an Girovo.',
     '<rect x="3" y="4.5" width="18" height="15" rx="3.5" stroke-width="2.3"/><path d="M7.4 10l2.8 2.4-2.8 2.4" stroke-width="2.3"/><path d="M13 15h3.8" stroke-width="2.3"/>'),
]
def svg(body, color):
    return f'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-linecap="round" stroke-linejoin="round" style="color:{color}">{body}</svg>'
def rows(api, theme, sel):
    ai_c, api_c = ('#b085ff', '#9ecaff') if theme == 'dark' else ('#7b4fe0', '#0060a8')
    def row(name, sub, body, c, on, tint):
        return f'<div class="it{" on" if on else ""}"><span class="disc" style="background:color-mix(in srgb,{tint} 18%,transparent)">{svg(body, c)}</span><span class="tx"><b>{name}</b><i>{sub}</i></span></div>'
    return f'<div class="side {theme}"><div class="grp">{row("Girovo AI", "Antworten in ganzen Sätzen", AI, ai_c, sel == "ai", ai_c)}{row("Girovo API", "Kommt bald", api, api_c, sel == "api", api_c)}</div></div>'
sections = ''.join(f'''<section><div class="lead"><h2>{name}</h2><p>{why}</p></div>
{rows(body, 'dark', 'ai')}{rows(body, 'dark', 'api')}{rows(body, 'light', 'none')}</section>''' for k, name, why, body in APIS)
html = f'''<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wdth,wght,ROND@6..144,25..151,1..1000,0..100&display=block');
body{{margin:0;padding:40px;width:1240px;background:#e9eef7;font-family:'Google Sans Flex',sans-serif;color:#161c24;-webkit-font-smoothing:antialiased}}
h1{{font-size:32px;font-weight:500;margin:0 0 6px}}.intro{{font-size:16px;color:#404753;margin:0 0 24px}}
section{{display:grid;grid-template-columns:260px repeat(3,288px);gap:20px;margin-bottom:22px;align-items:center}}
.lead h2{{font-size:20px;font-weight:500;margin:0 0 6px}}.lead p{{font-size:14px;line-height:20px;color:#404753;margin:0}}
.side{{padding:16px;border-radius:16px}}.side.dark{{background:#090f16;--row:#161c24;--ink:#dde3ee;--ink2:#bfc7d5;--pc:#00497f;--onpc:#d3e4ff}}
.side.light{{background:#eff4ff;--row:#ffffff;--ink:#161c24;--ink2:#404753;--pc:#d3e4ff;--onpc:#004880}}
.grp{{display:flex;flex-direction:column;gap:2px;border-radius:16px;overflow:hidden}}
.it{{display:flex;align-items:center;gap:12px;height:56px;padding:0 12px;background:var(--row);color:var(--ink)}}
.it.on{{background:var(--pc);color:var(--onpc)}}
.disc{{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;flex:none}}
.tx{{display:flex;flex-direction:column}}.tx b{{font-size:14px;line-height:20px;font-weight:500}}.tx i{{font-style:normal;font-size:12px;line-height:16px;color:var(--ink2)}}
.it.on .tx i{{color:var(--onpc)}}
.head{{display:grid;grid-template-columns:260px repeat(3,288px);gap:20px;font-size:13px;font-weight:500;color:#404753;margin-bottom:8px}}
</style></head><body>
<h1>Girovo API neben Girovo AI</h1><p class="intro">So wie in der Seitenleiste: Girovo AI offen, Girovo API offen, hell.</p>
<div class="head"><span></span><span>Dunkel, AI offen</span><span>Dunkel, API offen</span><span>Hell</span></div>
{sections}</body></html>'''
open(os.path.join(HERE, 'pair.html'), 'w', encoding='utf-8').write(html)
print('ok')
