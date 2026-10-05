# Sooskasse-FinTS 4.2.0

Faster, calmer updates. From this version on, an update usually downloads a few megabytes instead of the whole installer, and you can see what is happening while it installs. Nothing changes about how the app works with your bank.

## Smaller downloads
- **Only what changed.** Updates from 4.2.0 onward download only the parts of the installer that are new, typically 1–3 MB instead of about 110 MB. The download button shows the real size, for example "Herunterladen (1,6 MB)". On a slow or mobile connection that is the difference between minutes and seconds.
- **Still checked before anything runs.** The file built this way is checked against GitHub's checksum, like every full download. If anything doesn't fit, the app quietly downloads the whole installer instead.
- **Big updates stay big.** When a release replaces most of the app, for example a new Electron version, nearly everything has changed, and the download is close to full size.
- *This update to 4.2.0 is still a full download: earlier versions don't have what the smaller downloads build on. The installed copy of Sooskasse-FinTS now keeps the installer it came from, about 110 MB more in the installation folder.*

## You can see the update install
- **A progress window instead of an empty screen.** After you click to restart into a new version, the app closes and a small window shows how far the installation is: removing the old version, unpacking the new one, copying the files. It closes by itself once the new version is open.
- **Clear when it doesn't work.** If the installation stops, for example because the question about administrator rights was declined, the window says so and offers to open the version you still have.
- *An installation "for all users" still asks for administrator rights during the update. The installation itself takes about half a minute, as before.*

## Under the hood
- The portable version updates as before: the new file is saved next to the old one and started instead.
- *Nothing changes about what is sent or stored. The update check still sends only the app's version to GitHub.*
