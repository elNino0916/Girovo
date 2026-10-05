# Sooskasse-FinTS 4.2.2

A small update to the updater: big updates now also download a little less.

## Updates
- **Big updates reuse what they can, too.** Until now, an update that changed most of the installer, for example a new Electron version, was downloaded whole. Now the app keeps the parts that stayed the same and downloads only the rest, a few megabytes less. Everyday updates were already small and stay that way.
- *As always, the finished file is checked against GitHub's checksum before it runs. If nothing can be reused, the app downloads the whole installer as before.*
