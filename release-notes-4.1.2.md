# Sooskasse-FinTS 4.1.2

A small fix release: company logos are back on card payments.

## Company logos
- **Logos on card payments again.** Since 4.1.0, most card payments showed only initials, even for well-known shops like Kaufland, Steam, OpenAI or Discord. The logo check had become so strict that it rejected the real brand along with the look-alikes. It now trusts brands that the logo service Brandfetch has verified, so "Kaufland Muelheim" shows the Kaufland logo again.
- **Still no guessing.** A local shop that only shares a name with a company elsewhere, like a café or pizzeria, keeps its initials instead of borrowing a stranger's logo.
- *Logos still appear only if you turned on "Firmenlogos". Nothing changes about what is sent: only company names, never amounts or IBANs.*
