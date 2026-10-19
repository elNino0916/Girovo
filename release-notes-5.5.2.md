# Girovo 5.5.2

A fix for company logos.

## Fixes
- **No more wrong logo for "GmbH & Co.KG"** – a company written with "Co.KG" (without a space, as some banks do) was taken for a website and got that site's logo instead of its own; Beyerdynamic, for example. Girovo now looks for the company's name, and only real web addresses (such as amazon.de) count as one.
- **Fewer names mistaken for websites** – abbreviations with a dot, such as "Dr.Oetker" or "St.Gallen", are no longer read as web addresses either.

Logos already shown are corrected after the next start of Girovo.
