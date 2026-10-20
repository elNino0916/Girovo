# Girovo 5.7.0

On Android, Girovo now sorts bookings with Gemini Nano, the language model your phone already has, instead of a 300 MB download.

## Android
- **Categories with Gemini Nano** – bookings the rules don't recognise, such as a local bakery or a parking app, are sorted by Gemini Nano, which Android runs on the phone itself through AICore. Nothing to download in Girovo, and nothing leaves the phone. In our tests it filed clearly more bookings correctly than the previous model, with no more wrong guesses.
- **Your own rules count first** – a shop you filed yourself keeps your category under another spelling too ("HORNBACH BAUMARKT FIL. 0815" like "Hornbach Baumarkt AG").
- **Progress you can see** – while Gemini Nano works through your bookings, the Umsätze and the Analyse show "Kategorien werden zugeordnet · 120 von 300".
- **Phones without Gemini Nano** – Einstellungen → Auf diesem Telefon says "Nicht unterstütztes Telefon", and there the rules sort on their own, as before without the download.
- **Space back** – the old 280 MB text model is removed from the phone the first time this version starts.

The desktop app keeps its own category model; nothing changes there.
