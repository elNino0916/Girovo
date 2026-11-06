// The shell's own words, in the language the app speaks: the stored choice
// (fints.locale, lib/i18n/locale.ts), else the system's — German for a German
// system, English for every other (electron/i18n.cjs shellLocale). Only what
// the shell draws before the page can: the start window and the first start's
// migration screen. Everything else is the page's (lib/i18n/messages).

use crate::prefs::Prefs;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
  De,
  En,
}

pub fn lang(prefs: &Prefs) -> Lang {
  match prefs.get("fints.locale").as_deref() {
    Some("de") => return Lang::De,
    Some("en") => return Lang::En,
    _ => {}
  }
  let system = sys_locale::get_locale().unwrap_or_default().to_lowercase();
  if system.starts_with("de") { Lang::De } else { Lang::En }
}

/// The start window (splash.rs), as electron/i18n.cjs said it.
pub struct Splash {
  pub title: &'static str,
  pub title_updating: &'static str,
  pub slow: &'static str,
  pub portable: &'static str,
}

impl Splash {
  pub fn of(lang: Lang) -> Self {
    match lang {
      Lang::De => Splash {
        title: "Girovo wird gestartet",
        title_updating: "Girovo wird aktualisiert",
        slow: "Das dauert länger als sonst. Nach einer Aktualisierung oder einem Neustart des Computers braucht der erste Start oft mehr Zeit.",
        portable: "portabel",
      },
      Lang::En => Splash {
        title: "Starting Girovo",
        title_updating: "Updating Girovo",
        slow: "This is taking longer than usual. The first start after an update or after restarting the computer often takes more time.",
        portable: "portable",
      },
    }
  }

  pub fn step(lang: Lang, key: &str) -> &'static str {
    match (lang, key) {
      (Lang::De, "finishing") => "Aktualisierung abschließen",
      (Lang::De, "preparing") => "Girovo vorbereiten",
      (Lang::De, "checking") => "Nach Updates suchen",
      (Lang::De, "downloading") => "Update herunterladen",
      (Lang::De, "installing") => "Update installieren",
      (Lang::De, "starting") => "Girovo starten",
      (Lang::De, "opening") => "Fenster öffnen",
      (Lang::En, "finishing") => "Finish the update",
      (Lang::En, "preparing") => "Get Girovo ready",
      (Lang::En, "checking") => "Check for updates",
      (Lang::En, "downloading") => "Download the update",
      (Lang::En, "installing") => "Install the update",
      (Lang::En, "starting") => "Start Girovo",
      (Lang::En, "opening") => "Open the window",
      _ => "",
    }
  }

  pub fn progress(lang: Lang, n: u8) -> String {
    match lang {
      Lang::De => format!("{n} %"),
      Lang::En => format!("{n}%"),
    }
  }

  pub fn version(version: &str) -> String {
    format!("Version {version}")
  }

  /// During an update, from which version to which; a nightly's are long, so the new one starts a line of its own.
  pub fn version_to(from: &str, to: &str) -> String {
    if from.len() + to.len() > 28 { format!("Version {from}\n→ {to}") } else { format!("Version {from} → {to}") }
  }
}

/// The notification area while "Neue Umsätze melden" is on (background.rs).
pub struct Tray {
  pub tooltip: &'static str,
  pub open: &'static str,
  pub check: &'static str,
  pub quit: &'static str,
  /// The first time the window closes into the notification area.
  pub still_title: &'static str,
  pub still: &'static str,
}

impl Tray {
  pub fn of(lang: Lang) -> Self {
    match lang {
      Lang::De => Tray {
        tooltip: "Girovo – meldet neue Umsätze",
        open: "Girovo öffnen",
        check: "Jetzt nach neuen Umsätzen sehen",
        quit: "Beenden",
        still_title: "Girovo läuft weiter",
        still: "Im Infobereich, und meldet neue Umsätze. Beenden kannst du es über das Symbol dort.",
      },
      Lang::En => Tray {
        tooltip: "Girovo – reports new transactions",
        open: "Open Girovo",
        check: "Look for new transactions now",
        quit: "Quit",
        still_title: "Girovo keeps running",
        still: "In the notification area, reporting new transactions. Quit it from the icon there.",
      },
    }
  }
}

/// The first start of the Tauri app after the Electron one (migrate.rs).
pub struct Migration {
  pub title: &'static str,
  pub note: &'static str,
  /// A secret that could not be taken over: what to do about it.
  pub secret_failed: &'static str,
}

impl Migration {
  pub fn of(lang: Lang) -> Self {
    match lang {
      Lang::De => Migration {
        title: "Girovo zieht um",
        note: "Ab Version 6 läuft Girovo auf einer neuen, schlankeren Grundlage. Deine Banken, Konten und Einstellungen bleiben, wo sie sind.",
        secret_failed: "Windows Hello, „Weitere Banken mit anmelden“ und „Neue Umsätze melden“ ließen sich nicht übernehmen. Schalte sie in den Einstellungen wieder ein.",
      },
      Lang::En => Migration {
        title: "Girovo is moving",
        note: "From version 6, Girovo runs on a new, leaner foundation. Your banks, accounts and settings stay where they are.",
        secret_failed: "Windows Hello, “Log in to further banks too” and “Report new transactions” couldn’t be taken over. Turn them on again in Settings.",
      },
    }
  }

  pub fn step(lang: Lang, key: &str) -> &'static str {
    match (lang, key) {
      (Lang::De, "found") => "Gespeicherte Daten finden",
      (Lang::De, "settings") => "Einstellungen übernehmen",
      (Lang::De, "secret") => "Schlüssel übernehmen",
      (Lang::De, "autostart") => "Start mit Windows übernehmen",
      (Lang::De, "cleanup") => "Alte Zwischenspeicher löschen",
      (Lang::De, "starting") => "Girovo starten",
      (Lang::En, "found") => "Find the saved data",
      (Lang::En, "settings") => "Take over the settings",
      (Lang::En, "secret") => "Take over the key",
      (Lang::En, "autostart") => "Take over starting with Windows",
      (Lang::En, "cleanup") => "Delete the old caches",
      (Lang::En, "starting") => "Start Girovo",
      _ => "",
    }
  }
}
