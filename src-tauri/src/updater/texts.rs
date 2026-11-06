// What the updater tells the page when something goes wrong, in German and
// English — electron/i18n.cjs's `updates`, word for word. The page shows the
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
  lang: Lang,
}

impl Texts {
  /// Said at the start after an install that did not come up.
  pub fn not_completed(&self, version: &str) -> String {
    match self.lang {
      Lang::De => format!("Das Update auf Version {version} wurde nicht abgeschlossen. Du kannst es noch einmal versuchen."),
      Lang::En => format!("The update to version {version} was not completed. You can try again."),
    }
  }

  pub fn http_error(&self, status: u16) -> String {
    match self.lang {
      Lang::De => format!("GitHub hat mit einem Fehler geantwortet (HTTP {status})."),
      Lang::En => format!("GitHub answered with an error (HTTP {status})."),
    }
  }

  pub fn download_http(&self, status: u16) -> String {
    match self.lang {
      Lang::De => format!("Der Download ist fehlgeschlagen (HTTP {status})."),
      Lang::En => format!("The download failed (HTTP {status})."),
    }
  }
}

const DE: Texts = Texts {
  no_space: "Auf dem Laufwerk ist nicht genug Platz für das Update.",
  install_locked: "Das Update konnte nicht gestartet werden – die Datei ist gesperrt. Ein Virenscanner prüft sie vielleicht noch; versuche es gleich noch einmal.",
  folder_locked: "Die Datei konnte nicht gespeichert werden – der Ordner ist schreibgeschützt oder gesperrt.",
  file_gone: "Die heruntergeladene Datei ist nicht mehr da. Lade das Update noch einmal herunter.",
  timeout: "GitHub hat nicht rechtzeitig geantwortet. Versuche es später noch einmal.",
  connection_lost: "Die Verbindung zu GitHub ist abgebrochen. Versuche es noch einmal.",
  offline: "Keine Verbindung zu GitHub. Bist du mit dem Internet verbunden?",
  check_failed: "Die Suche nach Updates hat nicht geklappt.",
  download_failed: "Der Download hat nicht geklappt.",
  install_failed: "Das Update konnte nicht gestartet werden.",
  unreadable: "Die Antwort von GitHub war unverständlich.",
  too_large: "Die Datei ist größer als angekündigt und wurde verworfen.",
  interrupted: "Der Download wurde unterbrochen. Versuche es noch einmal.",
  rate_limited: "GitHub nimmt gerade keine weiteren Anfragen an. Versuche es später noch einmal.",
  no_folder: "Es gibt keinen Ordner, in dem die neue Version gespeichert werden kann.",
  digest_mismatch: "Die Datei stimmt nicht mit der Prüfsumme von GitHub überein und wurde gelöscht.",
  changed: "Die heruntergeladene Datei fehlt oder wurde verändert. Lade das Update noch einmal herunter.",
  lang: Lang::De,
};

const EN: Texts = Texts {
  no_space: "There is not enough space on the drive for the update.",
  install_locked: "The update could not be started – the file is locked. A virus scanner may still be checking it; try again in a moment.",
  folder_locked: "The file could not be saved – the folder is read-only or locked.",
  file_gone: "The downloaded file is no longer there. Download the update again.",
  timeout: "GitHub did not answer in time. Try again later.",
  connection_lost: "The connection to GitHub broke off. Try again.",
  offline: "No connection to GitHub. Are you connected to the internet?",
  check_failed: "Checking for updates did not work.",
  download_failed: "The download did not work.",
  install_failed: "The update could not be started.",
  unreadable: "GitHub’s answer could not be understood.",
  too_large: "The file is larger than announced and was discarded.",
  interrupted: "The download was interrupted. Try again.",
  rate_limited: "GitHub is not taking any more requests right now. Try again later.",
  no_folder: "There is no folder the new version can be saved in.",
  digest_mismatch: "The file does not match GitHub’s checksum and was deleted.",
  changed: "The downloaded file is missing or was changed. Download the update again.",
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
    assert_eq!(texts(Lang::De).http_error(503), "GitHub hat mit einem Fehler geantwortet (HTTP 503).");
    assert_eq!(texts(Lang::En).not_completed("9.9.9"), "The update to version 9.9.9 was not completed. You can try again.");
  }
}
