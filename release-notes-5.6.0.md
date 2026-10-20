# Girovo 5.6.0

On Android, Girovo now checks the phone it runs on and its own copy before you type your PIN.

## Android
- **Gerätesicherheit** – Girovo asks the phone's security hardware whether its bootloader is locked and the system is verified, as Android's key attestation reports it. Einstellungen → Auf diesem Telefon shows the result: the maker's Android, a custom Android with a locked bootloader (such as GrapheneOS), a modified phone, or a phone that can't prove its state.
- **A warning before the PIN** – on a modified phone (unlocked bootloader or unverified system) the login says so before you type your PIN, since an app with root rights could read it.
- **Only the real Girovo** – Girovo checks that it is signed with its own key or installed from Google Play. A copy someone else signed gets a clear warning at the login not to enter the PIN there.

The check runs on the phone; nothing is sent anywhere.
