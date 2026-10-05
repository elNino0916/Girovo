# Sooskasse-FinTS 4.3.0

Vorgemerkte Umsätze for Sparkasse customers. Until now the app never showed them for a Sparkasse account. From this version on they appear with your Umsätze.

## Vorgemerkt
- **Now at the Sparkasse too.** Sparkassen don't offer the separate request the app used for vorgemerkte Umsätze. Instead, they send them along with the Umsätze, and the app used to drop that part. Now it reads it: announced Lastschriften and card payments that are not booked yet show up in the Vorgemerkt panel and as "Vorgemerkt" beside the Kontostand.
- **No extra approval.** The list arrives with every Umsatzabruf, so there is nothing to fetch separately and no second approval in your banking app. That's why the panel has no "Vorgemerkte abrufen" button for these accounts.
- **Checked after a transfer, too.** When a transfer's status is unclear, "Jetzt nachsehen" now also searches the vorgemerkten Umsätze of a Sparkasse account, with the same single approval.
- **Never counted twice.** Vorgemerkte Umsätze stay out of the Kontostand, the Umsätze list, the CSV export and the Umsatzanalyse, as before.
- *If the bank sends vorgemerkte Umsätze the app can't read, the Umsätze still load as usual and the panel keeps the last list it had, marked with when that list was read. Banks that offer the separate request work as before.*
