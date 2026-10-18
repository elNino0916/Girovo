# Google Play store listing

Everything for Play Console › Store presence › Main store listing. German is
the default language, English a translation (add it under "Manage
translations").

| Play Console field | File | Limit |
|---|---|---|
| App name | `de-DE/title.txt`, `en-US/title.txt` | 30 characters |
| Short description | `de-DE/short-description.txt`, `en-US/short-description.txt` | 80 characters |
| Full description | `de-DE/full-description.txt`, `en-US/full-description.txt` | 4,000 characters |
| App icon | `icon-512.png` — 512 × 512, 32-bit PNG, full square (Play rounds it) | 1 MB |
| Feature graphic | `feature-graphic.png` — 1024 × 500, 24-bit PNG | 15 MB |
| Phone screenshots | `screenshots/1-…png` to `6-…png` — 1080 × 2160 (9:18), 24-bit PNG, German interface, in upload order | 2–8 |

The screenshots show the design preview's sample data (no real account).
They are made with the emulator: German, light, demo-mode status bar — see
the screenshot routine in the git history of this folder.

## Store settings

- **Category:** Finance
- **Tags:** Banking, Finance, Budget
- **Contact e-mail:** nino@elnino0916.de (as in the privacy policy)
- **Website:** https://elnino0916.de/girovo
- **Privacy policy:** https://elnino0916.de/girovo/privacy
- **Ads:** no
- **Content rating:** answer the questionnaire with "Finance", no user-generated content, no ads
- **Target audience:** 18 and over
- **Data safety:** see `data-safety.md`
- **Financial features declaration** (Policy › App content): "Banking — the app accesses the user's own accounts at their bank"; Girovo is not a bank and holds no money
