# Security

Girovo talks to your bank with your PIN, so a weakness in it matters. If you
find one, please tell us privately before anyone else.

## Reporting a vulnerability

Write to [contact@girovo.de](mailto:contact@girovo.de) with "Security" in the
subject. German or English, whichever is easier for you. Please include:

- the version (*Einstellungen → Über Girovo*) and where it runs — Windows,
  Linux, the GitHub APK or Google Play;
- what an attacker can do, and the steps that show it;
- whether you want to be named in the release notes of the fix.

Please do not open a public issue, and give us time to ship a fix before you
publish. We never ask for your PIN, a TAN or your bank login — leave them out
of every report, screenshot and log.

Only the latest release gets fixes. The desktop app and the GitHub APK offer
each update themselves; Google Play installs it through Play.

## In scope

Girovo itself: the desktop app, the Android app, the FinTS client in this
repository, how it stores and seals data on the device (the vault, the kept
Umsätze, backups, the fingerprint login), its updater and its device check.

A flaw in a bank's FinTS server belongs to that bank; a flaw in Electron,
Android or another dependency to its maintainers — tell us too if Girovo makes
it worse.

## Checking that a download is Girovo

Every release lists a SHA-256 for each file, in its `SHA256SUMS.txt` and on
the release page.

The GitHub APK (`Girovo-<version>-android.apk`) has been signed with the same
certificate since its first release:

```
SHA-256: 7E:4B:7B:7E:A6:0E:7A:19:B8:64:9D:F0:62:D6:39:A2:CB:0D:AA:85:AB:F2:0D:E9:39:98:0B:AD:9A:E6:CE:4C
```

Check a downloaded file with `apksigner verify --print-certs
Girovo-<version>-android.apk`, or an installed app with
[AppVerifier](https://github.com/soupslurpr/AppVerifier) and this entry:

```
de.elnino0916.android.girovo
7E:4B:7B:7E:A6:0E:7A:19:B8:64:9D:F0:62:D6:39:A2:CB:0D:AA:85:AB:F2:0D:E9:39:98:0B:AD:9A:E6:CE:4C
```

Girovo from Google Play is signed by Google's app signing key instead, so the
two cannot update over each other: install one or the other.

The same fingerprint is on [girovo.de](https://girovo.de/#download).
