# Integrity verdicts on Android, and what Girovo does with each

Written 24 November 2026, after the owner's S26 Ultra showed the gap: rooted
through a kernel exploit, with a true locked and verified attestation, and
read as `trusted`. The code is `lib/device-integrity.ts`; what the phone
reports is described in `android/README.md` ("Runtime integrity").

## Three answers, five verdicts

The check gives one of three answers. They must stay apart: no finding is not
a clean phone, and a doubt is not a finding.

| Answer (`integrityClass`) | Verdict | When |
|---|---|---|
| Verified integrity | `trusted` | Hardware attests a locked bootloader and the maker's system, and nothing stands against it. |
| | `custom` | The same with another system under its own key (GrapheneOS). |
| Confirmed modification | `modified` | A runtime finding, a pair of weak signs with a root tool's among them, an unlocked or unverified boot, or a system that contradicts its attestation. |
| Insufficient evidence | `inconclusive` | The attestation passes, and a root manager app is installed. New. |
| | `unknown` | The phone cannot attest its boot at all (no hardware attestation, a chain that does not end at Google, a revoked key, an emulator). |

`inconclusive` and `unknown` are the same answer for different reasons, and
the user is told which: "kann nicht nachweisen" for `unknown`, "Anzeichen für
Root-Zugriff" for `inconclusive`.

"Verified" means the boot is proven and Girovo saw nothing against it. It
does not mean there is no root. A root with no manager app in view and no
mounts in Girovo's process still reads as `trusted`; see "What stays open".

## What makes a phone inconclusive

One sign, alone beside an attestation that passes (`doubtSigns`): a root
manager app is installed. Girovo asks for nine by exact name (KernelSU and
its forks, Magisk and its forks, APatch, SuperSU, LSPosed's manager).

The app runs without root, so it proves nothing, and the phone is never
called `modified` for it. It is also all that a hidden root leaves. On the
S26 on 24 November 2026 the manager app was the only trace in Girovo's view,
so the phone is not called verified either.

With a second sign beside it the phone is `modified`: memory mounted over a
preinstalled app's folder, Samsung's Knox bit, or a revoked attestation key.

What does not make a phone inconclusive, on purpose:

- Memory mounted over a preinstalled app's folder (`covers`), alone. Root
  modules hide or replace apps that way; the S26 had three such mounts over
  YouTube in October. No stock phone is known to do it, and none is proven
  not to. A wrong guess would mark a whole model line at once, as the overlay
  rule marked every HyperOS phone until 5.14.1. So it is logged and counts
  as a pair's second sign. It can become a doubt once logs from stock
  Samsung, Xiaomi, OPPO and Pixel phones show it never appears there: one
  line in `doubtSigns`.
- Samsung's Knox bit. It says what the phone once was, and stays set for good
  on a phone that is back on Samsung's system. It would mark honest
  second-hand phones for life.
- The keys a system is signed with (`Build.TAGS`). Android's compatibility
  tests do not constrain the field, and the emulator's Play image has
  `dev-keys`. Logged only.
- A check that could not look. Several checks are refused on every phone
  (SELinux's mode, `/data/adb`). The mount table and the process map are
  always readable, but "unreadable" there can also be this app's parser
  meeting a line it did not expect. It stays logged.
- A revoked attestation key. It already answers `unknown`.

## What to do on an inconclusive phone

Girovo has no server and the bank does not ask for this check. It exists to
protect the user from their own phone: to say so before a PIN is typed where
something may read it, and to leave nothing on a phone that may hand it out.
Nobody is being policed, so a wrong doubt costs an honest user something and
gains nothing. That decides how to weigh the options.

Two kinds of phone end up inconclusive:

1. Rooted, the root hidden, the manager app in view. The owner's S26.
2. Not rooted, with a manager app installed out of curiosity or left over.

Nothing on the phone tells them apart.

What Girovo keeps on a phone, for reference: the remembered device (which
spares the bank's approval at login), the kept Umsätze, notes, categories and
documents, all in files sealed with the PIN; and, if the user turns it on, the
PIN itself behind the fingerprint. A root can read the PIN while it is typed
under every policy below. None of them changes that.

### A. Say it, restrict nothing

The Einstellungen row shows the orange mark and the reason. Everything works.

- Security: none beyond the notice. Phone 1 keeps its data and may seal its
  PIN behind the fingerprint on a rooted phone, without having been asked.
- Usability: no cost for anyone.
- The phone is no longer called trusted, and nothing else changes for it.

### B. Keep the data, never seal the PIN

As A, and the fingerprint switch is refused ("Auf diesem Telefon nicht
möglich"). Data stays.

- Security: the one standing secret, the PIN, never rests on the phone. The
  kept files remain, sealed with a PIN a root could read at the next login.
- Usability: phone 2 loses fingerprint login and nothing else.

### C. Keep nothing until the user allows it (implemented)

Handled as `unknown` is today: nothing is kept and nothing kept earlier is
read, the login says so in a neutral notice (no red warning), the fingerprint
switch is refused. The user may allow the keeping: hold "Schließen" in
Gerätesicherheit for 10 seconds, read the red warning, tick "Ich verstehe das
Risiko". The choice is remembered for this verdict; a phone that later reads
`modified` is asked again.

- Security: phone 1 is told what root apps can read before anything is kept,
  and decides. Nothing rests on the phone unasked. This is the existing rule
  in PRODUCT.md ("a modified phone, or one that cannot prove it is not")
  applied to a phone that has proven its boot and nothing more.
- Usability: until the user allows it, every start is a first start: bank
  list, login name, an approval from the bank at each login, no kept Umsätze,
  no notes or categories, no "Neue Umsätze melden". Phone 2 gets out by
  removing the app or by the 10-second hold. The Einstellungen dialog says
  which app was found and that removing it helps.
- What was kept before is not deleted. It is back once keeping is allowed.

### D. Treat as modified

Red warning at the login, plus everything in C.

- Rejected. It makes the manager app a proof of root in effect, which it is
  not, and tells phone 2 "Dieses Telefon ist verändert".

### E. Ask the user

On an inconclusive phone, ask once: "Hat dieses Telefon Root-Zugriff?" Yes
leads to C's warning, no to A.

- Security: as good as the answer. Since the check protects the person
  answering, an honest answer is likely; a wrong "no" harms only them.
- Usability: one question, once. Phone 2 answers "no" and loses nothing.
- Cost: a new dialog and its texts. Worth building only if C proves too
  harsh for people in phone 2's place.

### Recommendation

C, because it is the rule the product already has, it asks instead of
deciding, and it costs phone 2 one deliberate step.

To change the policy, `unsafePhone` in `lib/device-integrity.ts` is the one
place: it treats both kinds of insufficient evidence alike.

- For A: return `false` for `inconclusive` there.
- For B: split it. `keepsNothing` ignores `inconclusive`, the fingerprint
  switch (`FingerprintSwitch`, `offerSeal`) keeps refusing it.
- For E: C, plus a dialog that sets the stored choice.

## What stays open

- A root nobody can see. No manager app in view (Magisk can rename its app;
  KernelSU's can be removed after setup) and no mounts in Girovo's process:
  `trusted`. Nothing on the phone tells this apart from a clean phone, and
  Play Integrity does not either, since a kernel exploit leaves the
  attestation true. Removing the manager app is therefore also the way past
  this verdict, for a rooted phone as for a clean one.
- A PIN sealed earlier. A phone that read `trusted` when the PIN went behind
  the fingerprint keeps that login after it turns `inconclusive` or
  `modified`; only new sealing is refused. Dropping the sealed PIN when the
  verdict worsens would close that, at the price of one more typed PIN. Not
  decided, not built.
- A cover alone. A rooted phone that shows a module's mount and hides its
  manager app reads as `trusted` until `covers` is a doubt of its own.

## What others do

From the research of 24 November 2026:

- S-pushTAN refuses to run on a rooted phone outright
  (sparkasse.de/_pushtan/pushtanroot.html). comdirect and Commerzbank
  photoTAN have refused GrapheneOS as "rooted" while it was locked and
  unrooted (discuss.grapheneos.org/d/21448, /d/28440).
- RootBeer and OWASP's guide count a root manager app as a root sign;
  RootBeer dropped busybox after OnePlus, Moto and OPPO phones shipped it
  (github.com/scottyab/rootbeer, OWASP MASTG-KNOW-0027).
- Talsec's freeRASP sees root traces on 0.5 to 1 % of devices and advises to
  notify and log (docs.talsec.app, "Detecting rooted or jailbroken devices").
- Guardsquare's own note on key attestation (January 2026) says it cannot be
  trusted blindly, and names leaked keys and boot-chain exploits
  (guardsquare.com/blog/bypassing-key-attestation-api).
- Root on a locked bootloader was reported in 2026 for Galaxy S24, S25 and
  S26. Neither key attestation nor Play Integrity sees it.
- Google's key attestation guide says not to verify an attestation on the
  device it came from (developer.android.com/privacy-and-security/security-key-attestation).
  Girovo does, having no server, which is one more reason to treat a pass as
  proof of the boot only.
