# Girovo 5.0.1

Updates now come from Girovo's own home on GitHub. If you are coming from Sooskasse-FinTS, this is your update to Girovo: everything new in 5.0 is listed below. The update downloads only what changed, a few MB.

## New in 5.0.1
- **Updates from the Girovo repository.** From this version on, the app looks for updates at [github.com/elNino0916/Girovo](https://github.com/elNino0916/Girovo). Nothing else changes.

## New in 5.0, if you are coming from Sooskasse-FinTS

### A new name
- **Sooskasse-FinTS is now called Girovo.** It is the same app: it works with your bank as before. The bar at the top, the window title, the Start menu entry and the desktop shortcut, the installer, the update window and the "Erstellt mit" line on PDF statements now say Girovo.
- **Nothing to set up again.** The saved device, the encrypted personal data and your settings stay in the folder they were in, and Girovo finds them right after the update. The first start after the update says once that the app has a new name.
- **A pinned taskbar icon has to be pinned again.** Windows ties a pinned icon to the old program file, which the update replaces. If you pinned Sooskasse-FinTS to the taskbar, unpin it and pin Girovo. The Start menu and desktop shortcuts are replaced for you.
- *During this one update, the progress window can stay open for up to a minute after Girovo has started. It still looks for the old name. It closes by itself.*

### A new mark
- **The G€.** A G that carries the euro sign's two bars replaces the "€" plate: in the bar at the top, on the app icon, in the installer and in the update window.

### Error reports and usage data
- **Error reports go to the developer.** When something in the app breaks, a report goes to the developer's own server, so it can be fixed. It says where the error happened, with your bank's Bankleitzahl if it happened while talking to your bank. Before it leaves your computer, everything personal is masked: IBANs, amounts, dates, account numbers, names and e-mail addresses. Reports never contain your login name, PIN, balances or Umsätze.
- **Usage data only if you agree.** A tile on the Übersicht asks once: "Nutzungsdaten teilen?" With your yes, Girovo also tells the developer which parts of the app you use, how logins end and how long your bank takes to answer, with your bank's Bankleitzahl. Nothing about your accounts or bookings is included. You can change the answer at any time under Sitzung → "Nutzungsdaten teilen".
- *Like any connection, the developer's server sees your IP address. The login screen lists everything that leaves your computer.*

### Under the hood
- The installer also waits for an app called Sooskasse-FinTS to close before it installs, so the old version can finish ending the bank session and saving its settings.
- *The update check still sends only the app's version to GitHub, now as "Girovo/5.0.1".*
