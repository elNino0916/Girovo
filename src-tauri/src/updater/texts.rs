// What the updater tells the page when something goes wrong, in German and
// English — once the Electron shell's i18n.cjs's `updates`. The page shows the
// message as it comes (state.error.message), so it is in the shell's language
// (crate::texts::lang), asked each time a message is made: a change in the
// app reaches the next one.

use crate::texts::Lang;

pub struct Texts {
  pub no_space: &'static str,
  pub install_locked: &'static str,
  pub folder_locked: &'static str,
  pub file_gone: &'static str,
  pub timeout: &'static str,
  pub connection_lost: &'static str,
  pub offline: &'static str,
  pub check_failed: &'static str,
  pub download_failed: &'static str,
  pub install_failed: &'static str,
  pub unreadable: &'static str,
  pub too_large: &'static str,
  pub interrupted: &'static str,
  pub rate_limited: &'static str,
  pub no_folder: &'static str,
  pub digest_mismatch: &'static str,
  pub changed: &'static str,
  /// "Update aus Datei installieren": a file that is no signed release's installer.
  pub file_unsigned: &'static str,
  pub file_unreadable: &'static str,
  /// Only the installed Windows app installs from a file.
  pub file_not_here: &'static str,
  lang: Lang,
}

impl Texts {
  /// Said at the start after an install that did not come up.
  pub fn not_completed(&self, version: &str) -> String {
    match self.lang {
      Lang::De => format!("Das Update auf Version {version} hat nicht geklappt. Versuch es noch einmal."),
      Lang::En => format!("The update to version {version} didn’t work. Try again."),
    }
  }

  /// GitHub's quota for this connection used up: when it takes requests again, where it said (logic::rate_limit_wait).
  pub fn rate_limited_for(&self, minutes: Option<u64>) -> String {
    match (self.lang, minutes) {
      (_, None) => self.rate_limited.to_string(),
      (Lang::De, Some(1)) => "Die Suche nach Updates geht gerade nicht. Versuch es in etwa einer Minute noch einmal.".to_string(),
      (Lang::De, Some(m)) => format!("Die Suche nach Updates geht gerade nicht. Versuch es in etwa {m} Minuten noch einmal."),
      (Lang::En, Some(1)) => "Checking for updates isn’t possible right now. Try again in about a minute.".to_string(),
      (Lang::En, Some(m)) => format!("Checking for updates isn’t possible right now. Try again in about {m} minutes."),
    }
  }

  pub fn http_error(&self, status: u16) -> String {
    match self.lang {
      Lang::De => format!("Die Suche nach Updates hat nicht geklappt (Code {status})."),
      Lang::En => format!("Checking for updates didn’t work (code {status})."),
    }
  }

  pub fn download_http(&self, status: u16) -> String {
    match self.lang {
      Lang::De => format!("Der Download hat nicht geklappt (Code {status})."),
      Lang::En => format!("The download didn’t work (code {status})."),
    }
  }
}

const DE: Texts = Texts {
  no_space: "Nicht genug Speicherplatz für das Update.",
  install_locked: "Das Update ließ sich noch nicht starten. Versuch es gleich noch einmal.",
  folder_locked: "Das Update ließ sich auf diesem Rechner nicht speichern.",
  file_gone: "Das Update ist nicht mehr da. Lade es noch einmal herunter.",
  timeout: "Das hat zu lange gedauert. Versuch es später noch einmal.",
  connection_lost: "Die Verbindung ist abgebrochen. Versuch es noch einmal.",
  offline: "Keine Verbindung. Bist du online?",
  check_failed: "Die Suche nach Updates hat nicht geklappt.",
  download_failed: "Der Download hat nicht geklappt.",
  install_failed: "Das Update ließ sich nicht starten.",
  unreadable: "Die Suche nach Updates ging schief. Versuch es später noch einmal.",
  too_large: "Der Download war beschädigt und wurde gelöscht. Versuch es noch einmal.",
  interrupted: "Der Download wurde unterbrochen. Versuch es noch einmal.",
  rate_limited: "Die Suche nach Updates geht gerade nicht. Versuch es später noch einmal.",
  no_folder: "Girovo findet keinen Ordner für das Update.",
  digest_mismatch: "Das Update war beschädigt und wurde gelöscht. Versuch es noch einmal.",
  changed: "Das Update fehlt oder wurde verändert. Lade es noch einmal herunter.",
  file_unsigned: "Girovo erkennt diese Datei nicht als Update.",
  file_unreadable: "Die Datei ließ sich nicht lesen.",
  file_not_here: "Das geht nur in der installierten Windows-App.",
  lang: Lang::De,
};

const EN: Texts = Texts {
  no_space: "Not enough disk space for the update.",
  install_locked: "The update couldn’t start yet. Try again in a moment.",
  folder_locked: "The update couldn’t be saved on this computer.",
  file_gone: "The update is no longer there. Download it again.",
  timeout: "That took too long. Try again later.",
  connection_lost: "The connection dropped. Try again.",
  offline: "No connection. Are you online?",
  check_failed: "Checking for updates didn’t work.",
  download_failed: "The download didn’t work.",
  install_failed: "The update couldn’t start.",
  unreadable: "Checking for updates went wrong. Try again later.",
  too_large: "The download was damaged and has been deleted. Try again.",
  interrupted: "The download was interrupted. Try again.",
  rate_limited: "Checking for updates isn’t possible right now. Try again later.",
  no_folder: "Girovo can’t find a folder for the update.",
  digest_mismatch: "The update was damaged and has been deleted. Try again.",
  changed: "The update is missing or was changed. Download it again.",
  file_unsigned: "Girovo doesn’t recognise this file as an update.",
  file_unreadable: "The file couldn’t be read.",
  file_not_here: "This only works in the installed Windows app.",
  lang: Lang::En,
};

pub fn texts(lang: Lang) -> &'static Texts {
  match lang {
    Lang::De => &DE,
    Lang::En => &EN,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn both_languages_say_the_status() {
    assert_eq!(texts(Lang::De).http_error(503), "Die Suche nach Updates hat nicht geklappt (Code 503).");
    assert_eq!(texts(Lang::En).not_completed("9.9.9"), "The update to version 9.9.9 didn’t work. Try again.");
  }
}
