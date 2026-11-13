// Labelled set for cleaning up the counterparty name of a booking:
// [raw name as the statement carries it (MT940/CAMT via FinTS), purpose, expected brand].
// The expected brand is how a person would write it; an array lists every fair spelling.
// null means there is no brand to show (private persons, authorities, practices, clubs,
// landlords, small local shops, a payment service with nothing behind it).
// Everything here is invented; none of it is anyone's real data.

export const NAMES = [
  // Groceries and drugstores
  ['REWE Markt GmbH-Zwnl 4711', '', 'Rewe'],
  ['REWE SAGT DANKE. 41234567', '', 'Rewe'],
  ['LIDL DIENSTL GMBH 1234 KOBLENZ', '', 'Lidl'],
  ['Lidl sagt Danke', '', 'Lidl'],
  ['ALDI SUED SAGT DANKE 0123', '', ['Aldi Süd', 'Aldi', 'Aldi Sued']],
  ['ALDI GMBH & CO. KG KAMEN', '', ['Aldi', 'Aldi Nord']],
  ['EDEKA KRUEGER E.K. 6612', '', 'Edeka'],
  ['EDEKA SAGT DANKE', '', 'Edeka'],
  ['KAUFLAND DIENSTLEISTUNG GMBH & CO. KG', '', 'Kaufland'],
  ['NETTO MARKEN-DISCOUNT 7731 DORTMUND', '', ['Netto', 'Netto Marken-Discount']],
  ['PENNY.MARKT GMBH 3310 LEIPZIG DE', '', 'Penny'],
  ['dm-drogerie markt GmbH + Co. KG', '', ['dm', 'dm-drogerie markt']],
  ['DM FIL.2207 H:65', '', ['dm', 'dm-drogerie markt']],
  ['ROSSMANN 1834', '', 'Rossmann'],
  ['Dirk Rossmann GmbH', '', 'Rossmann'],
  ['MUELLER HANDELS GMBH 0815 ULM', '', ['Müller', 'Mueller', 'Müller Drogerie']],

  // Home, electronics, fashion, other retail
  ['IKEA DEUTSCHLAND GMBH & CO. KG NL KAARST', '', 'IKEA'],
  ['MEDIA MARKT KOELN-HOHE STR', '', ['MediaMarkt', 'Media Markt']],
  ['OBI BAU- UND HEIMWERKERMAER', '', 'OBI'],
  ['BAUHAUS GMBH & CO. KG FIL. 512', '', 'Bauhaus'],
  ['HORNBACH BAUMARKT AG FIL 742', '', 'Hornbach'],
  ['ZALANDO SE', '', 'Zalando'],
  ['H&M Hennes & Mauritz B.V. & Co. KG', '', 'H&M'],
  ['C&A Mode GmbH & Co. KG', '', 'C&A'],
  ['DECATHLON DEUTSCHLAND SE &', '', 'Decathlon'],
  ['THALIA BUECHER GMBH', '', 'Thalia'],
  ['Fressnapf Tiernahrungs GmbH', '', 'Fressnapf'],
  ['Otto GmbH & Co KG', 'Kundennr. 12345678 Rate 3/6', ['Otto', 'OTTO']],
  ['ALIEXPRESS.COM LUXEMBOURG LU', '', 'AliExpress'],
  ['TEMU.COM DUBLIN IE', '', 'Temu'],

  // Online shops and payment services with the shop in the purpose
  ['AMZN Mktp DE*AB12CD34E', '', 'Amazon'],
  ['AMAZON EU S.A R.L., NIEDERLASSUNG DEUTSCHLAND', '302-1234567-7654321 Amazon.de 4K7Q2X9P1M', 'Amazon'],
  ['PayPal Europe S.a.r.l. et Cie S.C.A', '1038475610293 PP.4417.PP . NETFLIX INTERNATIONAL B.V., Ihr Einkauf bei NETFLIX INTERNATIONAL B.V.', 'Netflix'],
  ['PayPal (Europe) S.a r.l. et Cie, S.C.A.', '1040123987654 PP.6620.PP . Otto GmbH & Co KG, Ihr Einkauf bei Otto GmbH & Co KG', ['Otto', 'OTTO']],
  ['Klarna Bank AB (publ)', 'Ihre Bestellung bei ABOUT YOU SE & Co. KG 10203040', 'About You'],
  ['Takeaway.com Payments B.V.', 'Lieferando Bestellung 7XK2M4', 'Lieferando'],
  ['Telefonica Germany GmbH & Co. OHG', 'O2 Rechnung Kd-Nr 7654321 11/2026', ['O2', 'o2', 'Telefonica', 'Telefónica']],
  ['freenet DLS GmbH', 'mobilcom-debitel Rechnung 0042137', ['freenet', 'mobilcom-debitel']],
  ['Google Payment Ireland Limited', 'GOOGLE *YouTubePremium g.co/helppay', ['YouTube', 'YouTube Premium']],
  ['Google Payment Ireland Limited', '', 'Google'],

  // Streaming, software, games
  ['PAYPAL *SPOTIFY', '', 'Spotify'],
  ['Spotify AB', 'Spotify P1A2B3C4D5 Premium', 'Spotify'],
  ['NETFLIX.COM', '', 'Netflix'],
  ['APPLE.COM/BILL', '', 'Apple'],
  ['Apple Distribution International', '', 'Apple'],
  ['DISNEY PLUS', '', ['Disney+', 'Disney Plus']],
  ['MICROSOFT*XBOX GAME PASS', '', ['Microsoft', 'Xbox']],

  // Telcos
  ['Telekom Deutschland GmbH', 'Kundennummer 123456789 Rechnung 10/2026', ['Telekom', 'Deutsche Telekom']],
  ['Vodafone GmbH', '', 'Vodafone'],
  ['Vodafone West GmbH', 'Kabel Internet Kd 1122334455', 'Vodafone'],
  ['1&1 Telecom GmbH', '', '1&1'],

  // Transport, travel, fuel
  ['DB Vertrieb GmbH', 'Fahrschein 123456789 Koeln Hbf - Berlin Hbf', 'Deutsche Bahn'],
  ['DB Fernverkehr AG', '', 'Deutsche Bahn'],
  ['FLIXBUS DE', '', ['FlixBus', 'Flixbus', 'Flix']],
  ['DEUTSCHE LUFTHANSA AKTIENGE', '', 'Lufthansa'],
  ['UBER *TRIP HELP.UBER.COM', '', 'Uber'],
  ['WWW.BOOKING.COM AMSTERDAM NL', '', 'Booking.com'],
  ['AIRBNB * HMAB12CD34', '', 'Airbnb'],
  ['ARAL STATION 281234', '', 'Aral'],
  ['Shell Deutschland GmbH 1A2B', '', 'Shell'],
  ['ESSO STATION 4471 MUENCHEN DE', '', 'Esso'],
  ['TOTAL STATION HAMBURG-ALTONA', '', ['TotalEnergies', 'Total']],
  ['ADAC E.V.', 'Mitgliedsbeitrag 2027', 'ADAC'],

  // Food out
  ['McDonalds 1234 Berlin DE', '', ["McDonald's", 'McDonalds']],
  ['BURGER KING 21233 HAMBURG', '', 'Burger King'],
  ['STARBUCKS COFFEE 1450 FRANKFURT', '', 'Starbucks'],

  // Insurers, energy, banks
  ['HUK-COBURG HAFTPFLICHT-UNTE', '', ['HUK-Coburg', 'HUK']],
  ['Allianz Versicherungs-AG', 'VS-Nr. AS-1234567890 Hausrat', 'Allianz'],
  ['ERGO Vorsorge Lebensversicherung AG', '', ['ERGO', 'Ergo']],
  ['Techniker Krankenkasse', 'Zusatzbeitrag', ['Techniker Krankenkasse', 'TK']],
  ['E.ON Energie Deutschland GmbH', 'Abschlag Strom VK 2040123456', 'E.ON'],
  ['EnBW Energie Baden-Wuerttemberg AG', '', 'EnBW'],
  ['ING-DiBa AG', 'Sparplan', ['ING', 'ING-DiBa']],
  ['Commerzbank AG', 'Kreditkartenabrechnung 10/2026', 'Commerzbank'],
  ['Trade Republic Bank GmbH', 'Sparplan 7781', 'Trade Republic'],

  // No brand: private persons
  ['Familie Braun', 'Miete Garage Oktober', null],
  ['Dr. Anna Schulz', 'Rechnung 2026-0412 Behandlung', null],
  ['MAXIMILIAN HOFFMANN', 'Danke fuer die Konzertkarte', null],
  ['Lea Wagner', 'Pizza gestern', null],
  ['Jonas und Miriam Fischer', '', null],
  ['WEBER, KATHARINA', 'Taschengeld November', null],
  ['THOMAS MUELLER', 'Miete Stellplatz 11/2026', null],

  // No brand: authorities and institutions
  ['Finanzamt Koeln-Sued', 'StNr 215/5123/4567 ESt 2025', null],
  ['Stadtkasse Duesseldorf', 'Hundesteuer 2026 Az 32.1-4411', null],
  ['Bundeskasse in Trier', 'Kfz-Steuer K-XY 1234', null],
  ['Rundfunk ARD, ZDF, DRadio', 'Beitragsnummer 123456789', null],
  ['Deutsche Rentenversicherung Bund', '', null],
  ['Bundesagentur fuer Arbeit - Familienkasse', 'Kindergeld KG123FK456789', null],
  ['LANDESHAUPTKASSE NRW', 'Bezuege 11/2026', null],
  ['Stadtwerke Bonn GmbH', 'Abschlag Gas 11/2026', null],

  // No brand: practices, clubs, landlords
  ['Gemeinschaftspraxis Dr. med. Yilmaz u. Kollegen', '', null],
  ['Zahnarztpraxis Dr. Ruth Albers', '', null],
  ['Physiotherapie am Markt', '', null],
  ['Rechtsanwaelte Voss & Partner mbB', '', null],
  ['TuS Blau-Weiss Lindenthal e.V.', 'Mitgliedsbeitrag 2026', null],
  ['Foerderverein der Grundschule Am Park e.V.', 'Spende', null],
  ['Kita Sonnenschein e.V.', 'Essensgeld November', null],
  ['Kath. Kirchengemeinde St. Agnes', 'Spende', null],
  ['Hausverwaltung Kremer GmbH', 'Miete 11/2026 Whg 3 OG links', null],
  ['IMMOBILIENVERWALTUNG BRANDT', 'Hausgeld 11/2026', null],

  // No brand: small local shops
  ['BAECKEREI HOEFER INH. K. HOEFER', '', null],
  ['Pizzeria Bella Napoli', '', null],
  ['SumUp *Cafe Lind', '', null],
  ['SumUp *Eisdiele Venezia', '', null],
  ['Metzgerei Schmitz GmbH', '', null],
  ['Blumen Koenig Inh. Petra Koenig e.K.', '', null],
  ['Kiosk am Ring', '', null],
  ['Friseursalon Haarmonie', '', null],
  ['Weingut Hessler', '', null],
  ['Fahrschule Oezdemir', 'Fahrstunden 5x', null],

  // No brand: payment service with nothing behind it
  ['PayPal Europe S.a.r.l. et Cie S.C.A', '1039485712345 PP.5521.PP . Abbuchung vom PayPal-Konto', null],
  ['Klarna Bank AB', '', null],
];
