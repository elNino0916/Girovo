# Invented invoices and shop receipts as photos, with their answers (truth.json). None of it is anyone's real data.
import json, random, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

random.seed(7)
import sys
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'set')
os.makedirs(OUT, exist_ok=True)
F = 'C:/Windows/Fonts/'
def font(name, size):
    return ImageFont.truetype(F + name, size)

def iban_de(bank, acct):
    # A valid German IBAN from a BLZ and account number.
    bban = f'{bank:08d}{acct:010d}'
    num = int(bban + '131400')
    check = 98 - num % 97
    return f'DE{check:02d}{bban}'

def spaced(iban):
    return ' '.join(iban[i:i + 4] for i in range(0, len(iban), 4))

def eur(x):
    s = f'{x:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return s

def photo(img, name):
    img = img.rotate(random.uniform(-3, 3), expand=True, fillcolor=(205, 200, 190))
    img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 0.9)))
    w, h = img.size
    img = img.resize((int(w * 0.8), int(h * 0.8)))
    img.save(os.path.join(OUT, name), quality=random.randint(60, 80))

COMPANIES = [
    ('Elektro Wagner GmbH', 'Hauptstr. 12, 56068 Koblenz'), ('Dachdeckerei Brandt & Söhne', 'Am Ring 4, 50667 Köln'),
    ('Stadtwerke Talheim GmbH', 'Werkstr. 1, 74388 Talheim'), ('Zahnarztpraxis Dr. Lehmann', 'Marktplatz 3, 53111 Bonn'),
    ('Kfz-Meisterbetrieb Roth', 'Industriestr. 22, 65189 Wiesbaden'), ('Malerbetrieb Kaya e.K.', 'Lindenweg 8, 60311 Frankfurt'),
    ('Webhosting Nordlicht GmbH', 'Hafenstr. 9, 20457 Hamburg'), ('Schornsteinfeger Meister Klein', 'Kirchgasse 2, 56073 Koblenz'),
    ('Fahrschule Özdemir', 'Bahnhofstr. 15, 44135 Dortmund'), ('Tierarztpraxis am Park', 'Parkallee 6, 28209 Bremen'),
    ('Gartenbau Hessler GmbH & Co. KG', 'Feldweg 30, 67433 Neustadt'), ('IT-Service Becker UG', 'Schulstr. 5, 76133 Karlsruhe'),
]
truth = []
for i, (name, addr) in enumerate(COMPANIES):
    img = Image.new('RGB', (1240, 1754), 'white')
    d = ImageDraw.Draw(img)
    big, mid, small = font('arialbd.ttf', 44), font('arial.ttf', 28), font('arial.ttf', 24)
    d.text((90, 90), name, font=big, fill='black')
    d.text((90, 150), addr, font=small, fill=(60, 60, 60))
    d.text((90, 300), 'Herrn Max Mustermann\nMusterweg 1\n12345 Musterstadt', font=mid, fill='black', spacing=8)
    num = f'RE-2026-{random.randint(1000, 9999)}'
    day = random.randint(1, 28)
    d.text((780, 300), f'Rechnungsnr.: {num}\nDatum: {day:02d}.10.2026\nKundennr.: {random.randint(10000, 99999)}', font=small, fill='black', spacing=8)
    d.text((90, 520), 'Rechnung', font=font('arialbd.ttf', 36), fill='black')
    y = 600
    items = random.sample([('Arbeitszeit Monteur', 68.0), ('Material', 42.5), ('Anfahrt', 35.0), ('Wartung', 89.0), ('Prüfung', 55.0), ('Ersatzteil', 128.4), ('Beratung', 75.0)], 3)
    net = 0
    for t, p in items:
        q = random.randint(1, 3)
        d.text((90, y), f'{q} x {t}', font=small, fill='black')
        d.text((900, y), f'{eur(q * p)} €', font=small, fill='black')
        net += q * p
        y += 44
    vat = round(net * 0.19, 2)
    total = round(net + vat, 2)
    y += 20
    d.line((90, y, 1150, y), fill='black', width=2)
    y += 20
    d.text((600, y), 'Nettobetrag', font=small, fill='black'); d.text((900, y), f'{eur(net)} €', font=small, fill='black'); y += 40
    d.text((600, y), 'zzgl. 19 % MwSt.', font=small, fill='black'); d.text((900, y), f'{eur(vat)} €', font=small, fill='black'); y += 40
    d.text((600, y), 'Rechnungsbetrag', font=font('arialbd.ttf', 26), fill='black'); d.text((900, y), f'{eur(total)} €', font=font('arialbd.ttf', 26), fill='black'); y += 90
    iban = iban_de(random.randint(10000000, 87000000), random.randint(1000000, 9999999999))
    d.text((90, y), f'Bitte überweisen Sie den Betrag innerhalb von 14 Tagen unter Angabe der\nRechnungsnummer {num} auf folgendes Konto:', font=small, fill='black', spacing=6); y += 90
    d.text((90, y), f'Kontoinhaber: {name}\nIBAN: {spaced(iban)}\nBIC: {random.choice(["COBADEFFXXX", "GENODED1XXX", "MALADE51KOB"])}', font=small, fill='black', spacing=6)
    photo(img, f'inv{i:02d}.jpg')
    truth.append({'file': f'inv{i:02d}.jpg', 'type': 'invoice', 'name': name, 'iban': iban, 'amount': total, 'number': num, 'date': f'2026-10-{day:02d}'})

SHOPS = [
    ('REWE', 'groceries', [('Bio Vollmilch', 1.29), ('Bananen', 1.79), ('Spaghetti', 0.99), ('Tomaten passiert', 1.19), ('Gouda', 2.49)]),
    ('dm-drogerie markt', 'groceries', [('Zahnpasta', 1.95), ('Shampoo', 2.45), ('Duschgel', 1.25), ('Wattepads', 0.85)]),
    ('ARAL', 'mobility', [('Super E10 41,32 l', 72.31), ('Kaffee', 2.90)]),
    ('MediaMarkt', 'shopping', [('USB-C Kabel', 14.99), ('Kopfhörer', 39.99)]),
    ('Bäckerei Hoefer', 'groceries', [('Brötchen x6', 2.70), ('Croissant', 1.40), ('Bauernbrot', 3.90)]),
    ('Pizzeria Bella Napoli', 'dining', [('Pizza Margherita', 9.50), ('Pizza Salami', 11.00), ('Cola 0,33', 3.20)]),
    ('OBI', 'shopping', [('Schrauben Set', 6.99), ('Wandfarbe weiß 10l', 34.99), ('Pinsel', 4.49)]),
    ('Apotheke am Markt', 'health', [('Ibuprofen 400', 4.97), ('Nasenspray', 3.95)]),
    ('LIDL', 'groceries', [('Äpfel 1kg', 2.29), ('Joghurt', 0.49), ('Brot', 1.59), ('Butter', 2.19), ('Kaffee 500g', 4.99), ('Wasser 6x1,5l', 1.74)]),
    ('Kino Odeon', 'leisure', [('Eintritt Erw.', 12.50), ('Eintritt Erw.', 12.50), ('Popcorn groß', 6.90)]),
    ('Café Lind', 'dining', [('Cappuccino', 3.80), ('Käsekuchen', 4.20)]),
    ('IKEA', 'shopping', [('Regal KALLAX', 49.99), ('Kerzen 20er', 4.99), ('Kleiderbügel', 3.49)]),
]
for i, (shop, cat, items) in enumerate(SHOPS):
    h = 520 + 46 * len(items) + 300
    img = Image.new('RGB', (620, h), (250, 249, 245))
    d = ImageDraw.Draw(img)
    mono, monob = font('cour.ttf', 24), font('courbd.ttf', 30)
    d.text((40, 40), shop.upper(), font=monob, fill='black')
    d.text((40, 90), f'Filiale {random.randint(100, 999)}\nTel. 0{random.randint(200, 899)} {random.randint(100000, 999999)}', font=mono, fill='black', spacing=4)
    y = 200
    total = 0
    for t, p in items:
        d.text((40, y), t[:22], font=mono, fill='black'); d.text((470, y), eur(p), font=mono, fill='black')
        total += p; y += 46
    total = round(total, 2)
    y += 10
    d.text((40, y), '-' * 34, font=mono, fill='black'); y += 40
    d.text((40, y), 'SUMME EUR', font=monob, fill='black'); d.text((440, y), eur(total), font=monob, fill='black'); y += 60
    day = random.randint(1, 28)
    d.text((40, y), f'Kartenzahlung girocard\n{day:02d}.10.2026  {random.randint(8, 20):02d}:{random.randint(0, 59):02d}\nVielen Dank für Ihren Einkauf!', font=mono, fill='black', spacing=6)
    photo(img, f'rec{i:02d}.jpg')
    truth.append({'file': f'rec{i:02d}.jpg', 'type': 'receipt', 'name': shop, 'amount': total, 'date': f'2026-10-{day:02d}', 'category': cat, 'items': len(items)})

json.dump(truth, open(os.path.join(OUT, 'truth.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(truth), 'images')
