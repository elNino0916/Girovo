# Girovo 5.7.0

On Android, Girovo now sorts bookings with Gemini Nano, the language model your phone already has, instead of a 300 MB download – and the phone layout is tidier, from the Übersicht with several banks to a new Einstellungen screen.

## Android
- **Categories with Gemini Nano** – bookings the rules don't recognise, such as a local bakery or a parking app, are sorted by Gemini Nano, which Android runs on the phone itself through AICore. Nothing to download in Girovo, and nothing leaves the phone. In our tests it filed clearly more bookings correctly than the previous model, with no more wrong guesses. Einstellungen marks it in Gemini's colours, with a check while it is at work.
- **Your own rules count first** – a shop you filed yourself keeps your category under another spelling too ("HORNBACH BAUMARKT FIL. 0815" like "Hornbach Baumarkt AG").
- **Progress you can see** – while Gemini Nano works through your bookings, the Umsätze and the Analyse show "Kategorien werden zugeordnet · 120 von 300".
- **Phones without Gemini Nano** – Einstellungen says "Nicht unterstütztes Telefon", and there the rules sort on their own, as before without the download.
- **Space back** – the old 280 MB text model is removed from the phone the first time this version starts.
- **A calmer Übersicht with several banks** – your accounts are one row of cards to swipe through, each bank's name above its own. A bank you are not logged in to is a single line with "Anmelden", instead of three mentions. The Gesamtsaldo appears once every balance is in, and with a single account the balance itself names its bank.
- **Einstellungen as its own screen** – it opens with a back arrow, without the navigation bar, and is grouped the way Android's own settings are: Allgemein, Sicherheit, Kategorien, Datenschutz, Auf diesem Telefon and Über Girovo, each setting in a line or two.
- **Gerätesicherheit at a glance** – a green check, an orange exclamation mark or a red cross says how the phone's check came out; tap it for the details.
- **Nothing kept on an unsafe phone** – on a phone that is modified, or that cannot prove its state, Girovo now stores nothing: no remembered device, no saved data, Umsätze, documents, fingerprint PIN or login name. The session lasts until you log out, and the login says so before you start.
- **Loading indicators** – short waits in buttons and lists show Material's turning arc instead of a still dot, and pull to refresh shows Material 3 Expressive's shape-morphing indicator.

## Everywhere
- **Einstellungen, regrouped** – the same grouped sections on the desktop, with short descriptions; what an action does in full is said in its dialog.
- **A bank you are not logged in to** is one row with "Anmelden" in Konten und Karten.
- **Company logos** – a recipient named "WWW.Amazon." now gets Amazon's logo, and Deutsche Bahn's companies (DB Dialog, DB Vertrieb, DB Fernverkehr …) get the DB logo.

The desktop app keeps its own category model; nothing changes there.
