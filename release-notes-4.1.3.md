# Sooskasse-FinTS 4.1.3

A maintenance release. The app's building blocks are up to date, including the FinTS library that talks to your bank. Nothing changes in how the app looks or works.

## Talking to your bank
- **Long transaction lists arrive complete.** When a bank splits a large answer over several messages, for example when you load 12 months, the library now keeps every part instead of risking that later bookings go missing.
- **Umlauts are sent correctly.** Text with ä, ö, ü or ß now reaches the bank in the encoding FinTS expects.
- **Login works at more banks.** Banks that check the security profile strictly, such as Consorsbank, no longer reject the login with "Ungültiger Signaturaufbau".
- **No mix-ups between sub-accounts.** If two of your accounts share an account number, the app no longer risks showing one account's balance or bookings for the other. It reports an error instead.
- **Your earlier fixes stay in.** The shop name on card payments and the support for banks that only send account statements in the camt.053 format work as before.

## Under the hood
- Updated to Electron 44, Next.js 16.3 and React 19.3.
- *Nothing changes about what is sent or stored. Company logos still appear only if you turned on "Firmenlogos".*
