# Girovo im Microsoft Store

Herausgeber im Store: **MT-Media** (Partner-Center-Konto von Moritz Krug).

Die Store-Version ist dasselbe Programm wie die Setup.exe, nur als **MSIX**
verpackt (`scripts/dist-store.mjs`). Der Store signiert das Paket selbst, ein
eigenes Code-Signing-Zertifikat ist nicht nötig.

Läuft Girovo aus dem MSIX-Paket, erkennt es das an der Paket-Identität
(`src-tauri/src/store.rs`, `GetCurrentPackageFullName`):

- Der eigene Updater fragt GitHub nie (`InstallKind::Store`, `updater/engine.rs`).
  Updates kommen über den Store.
- Die Oberfläche zeigt keine Updates, keinen Update-Kanal und kein
  „Aus Datei installieren“ (`components/updates/store.ts`, wie bei Play und F-Droid).
- Telemetrie meldet die Installationsart als `store`.

## Einmalig: Partner Center

1. https://partner.microsoft.com/dashboard → **Apps und Spiele** → **Neues Produkt** →
   **MSIX- oder PWA-App** → Namen **Girovo** reservieren.
2. In der App: **Produktverwaltung** → **Produktidentität**. Von dort drei Werte
   in `src-tauri/msix/identity.json` eintragen:
   - `Package/Identity/Name` → `"name"`
   - `Package/Identity/Publisher` (beginnt mit `CN=`) → `"publisher"`
   - `Package/Properties/PublisherDisplayName` → `"publisherDisplayName"` (soll `MT-Media` sein)

   Die Werte sind nicht geheim und werden mit eingecheckt.

## Paket bauen

Auf Windows mit Rust, den C++ Build Tools und dem Windows SDK:

```
npm install
npm run store:dist
```

Ergebnis: `dist/Girovo-<version>-x64.msix`. Die Version kommt aus `package.json`
(`6.3.0` wird `6.3.0.0`). Jede Einreichung braucht eine höhere Version als die
vorige. Nightly- und Next-Versionen (`6.4.0-nightly…`) baut das Skript nicht.

### Vorher hier testen

```
npm run store:dist -- --test-sign
```

Das signiert das Paket zusätzlich mit einem selbst erstellten Zertifikat
(`dist/girovo-store-test.cer`). Das Zertifikat einmal per Doppelklick unter
**Lokaler Computer → Vertrauenswürdige Personen** installieren, dann die
`.msix` öffnen. Diese test-signierte Datei **nicht** hochladen. Für den Store
`npm run store:dist` ohne `--test-sign` nehmen. Eine signierte Datei wird zwar
auch angenommen, aber das ist unnötig.

## Einreichung

In Partner Center → Girovo → **Neue Übermittlung starten**:

| Bereich | Was |
|---|---|
| Preise und Verfügbarkeit | Kostenlos, Märkte: mindestens Deutschland (Girovo spricht nur mit deutschen Banken) |
| Eigenschaften | Kategorie **Finanzen**. Datenschutzrichtlinie: `https://girovo.de/datenschutz`. Website: `https://girovo.de`. Support: `contact@girovo.de` |
| Altersfreigaben | Fragebogen ausfüllen (keine Gewalt, keine Käufe, Internetzugriff ja) |
| Pakete | `dist/Girovo-<version>-x64.msix` hochladen |
| Store-Einträge | Deutsch (und Englisch): Beschreibung, mindestens 1 Screenshot (1920×1080 oder größer), Hinweise siehe unten |

**Erklärung für die Zertifizierung** („Notes for certification“): Die App
braucht `runFullTrust`, weil sie eine Desktop-App (Tauri/WebView2) ist. Zum
Testen ist ein echter Bankzugang nötig. Die Tester können aber ohne Anmeldung
die Oberfläche ansehen. Sie verbindet sich per FinTS direkt mit der Bank,
ohne eigenen Server.

## Bekannte Grenzen der Store-Version

- **Start mit Windows** („Neue Umsätze melden“, `background.rs`) schreibt in
  `HKCU\…\Run`. In einem MSIX-Paket landet das im virtuellen Registry-Bereich
  des Pakets, Windows startet die App dann nicht beim Anmelden. Abhilfe wäre
  eine `windows.startupTask`-Erweiterung im Manifest plus die `StartupTask`-API.
  Das ist noch nicht gebaut.
- Daten liegen wie bisher unter `%APPDATA%\Girovo`. Windows leitet Schreibzugriffe
  eines MSIX-Pakets in den Paketordner um (`%LOCALAPPDATA%\Packages\<Paket>\LocalCache`).
  Deinstalliert man die Store-Version, sind ihre Daten weg. Eine parallel
  installierte Setup.exe-Version sieht sie nicht.
- Nur x64.
