// What telemetry may carry, decided in one place (telemetry.rs sends only
// what passes through here) — electron/telemetry-scrub.cjs, rule for rule.
//
// Nothing about the user's money leaves the machine: no IBAN, balance,
// booking, amount, payee, Verwendungszweck, login name or PIN. Two kinds of
// input need care:
//
//   free text  error messages and stacks. Most are the code's own words, but a
//              message can quote what a bank said, and a bank's text can name
//              a person (the Namensabgleich does) or carry an amount. text()
//              masks everything that looks like one of those.
//   fields     event properties. Only fields an event declares in its spec are
//              kept, and each must match its type exactly — so no free text
//              can ride along in a property.
//
// The patterns are JavaScript's, read the way JavaScript reads them: `\d`,
// `\w` and `\b` are ASCII only there, `\s` is JavaScript's own set of spaces,
// and lengths count UTF-16 units. Where Rust's regex counts characters
// instead (a quoted text or a label's text with emoji in it), it masks a
// little more, never less. The one rule that needs a lookahead, the URL's
// query, is written out by hand (strip_queries), as `regex` has none.
//
// Everything here is pure, so the tests below pin it — the very cases of
// electron/telemetry-scrub.test.cjs.

use std::sync::LazyLock;

use regex::{Captures, Regex};
use serde_json::{Map, Value};

use crate::save::{utf16_len, utf16_prefix};

pub const MAX_MESSAGE: usize = 300;
const MAX_FRAMES: usize = 30;

/// JavaScript's `\s`, for a character class: its white space and line terminators.
const S: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

fn js_space(c: char) -> bool {
  matches!(c, '\t' | '\n' | '\x0B' | '\x0C' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}

fn js_trim(s: &str) -> &str {
  s.trim_matches(js_space)
}

fn re(pattern: &str) -> Regex {
  Regex::new(&pattern.replace("{S}", S)).expect("telemetry-scrub pattern")
}

enum Replace {
  With(&'static str),
  /// Text in quotes, unless it is a single code word ('amount', "fetchFromBank").
  Quoted,
}

struct Rule(Regex, Replace);

static CODE_WORD: LazyLock<Regex> = LazyLock::new(|| re(r"^[A-Za-z_$][A-Za-z0-9_$.]{0,60}$"));

/// The rules after the URL's: in their order, as RULES in telemetry-scrub.cjs.
static RULES: LazyLock<Vec<Rule>> = LazyLock::new(|| {
  vec![
    // Home folders name the person using the machine.
    Rule(re(r#"(?i)([A-Za-z]:[\\/]+Users[\\/]+)[^\\/{S}'"<>:]+"#), Replace::With("${1}~")),
    Rule(re(r#"(/(?:Users|home)/)[^/{S}'"<>:]+"#), Replace::With("${1}~")),
    Rule(re(r"[A-Za-z0-9_.+-]+@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+"), Replace::With("[E-Mail]")),
    // IBAN, with or without its groups of four.
    Rule(re(r"(?-u:\b)[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]){11,30}(?-u:\b)"), Replace::With("[IBAN]")),
    // What follows a label that introduces a person or a booking's text.
    Rule(
      re(r"(?i)(?-u:\b)(Empfänger(?:name)?|Zahlungsempfänger|Auftraggeber|Kontoinhaber(?:in)?|Inhaber(?:in)?|Name|Verwendungszweck|Begünstigter|Payee|Recipient|Creditor|Debtor)([{S}]*[:=]?[{S}]*)[^\n.;]{1,120}"),
      Replace::With("${1}${2}[…]"),
    ),
    Rule(re(r#""([^"\n]{1,200})"|'([^'\n]{1,200})'|„([^“”\n]{1,200})[“”]|«([^»\n]{1,200})»|‚([^‘’\n]{1,200})[‘’]"#), Replace::Quoted),
    // Dates: a booking date is part of a booking.
    Rule(
      re(r"(?-u:\b)[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4}(?-u:\b)|(?-u:\b)[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9:.]+Z?)?(?-u:\b)"),
      Replace::With("[Datum]"),
    ),
    // Amounts: "1.234,56", "49,99", "49.99 EUR".
    Rule(re(r"(?-u:\b)[0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]+)?(?-u:\b)|(?-u:\b)[0-9]+[.,][0-9]{2}(?-u:\b)"), Replace::With("[Betrag]")),
    // Long numbers: account numbers, BLZ, references. Short ones (an HTTP
    // status, a FinTS return code like 9942) stay — they say what went wrong.
    Rule(re(r"[0-9]{5,}"), Replace::With("[Zahl]")),
  ]
});

static SPACES: LazyLock<Regex> = LazyLock::new(|| re(r"[{S}]+"));
static FRAME_LINE: LazyLock<Regex> = LazyLock::new(|| re(r"^[{S}]*at[{S}]"));
static ERROR_NAME: LazyLock<Regex> = LazyLock::new(|| re(r"^[A-Za-z_$][A-Za-z0-9_$]{0,40}$"));

fn apply(rule: &Rule, s: &str) -> String {
  match &rule.1 {
    Replace::With(with) => rule.0.replace_all(s, *with).into_owned(),
    Replace::Quoted => rule
      .0
      .replace_all(s, |c: &Captures| {
        let inner = (1..=5).find_map(|i| c.get(i)).map(|m| m.as_str()).unwrap_or("");
        if CODE_WORD.is_match(inner) { c[0].to_string() } else { "\"…\"".to_string() }
      })
      .into_owned(),
  }
}

fn word(c: Option<&char>) -> bool {
  c.is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_')
}

/// A URL keeps its origin and path; query and fragment can carry anything.
/// A stack frame's ":line:col" after the query stays. The first rule of
/// telemetry-scrub.cjs, with its lookahead:
///
///   (\b(?:https?|file):\/\/[^\s?#'"<>]*)[?#][^\s'"<>()]*?(?=(?::\d+){1,2}(?=[\s)'"<>]|$)|[\s)'"<>]|$)  → $1   (flags gi)
fn strip_queries(s: &str) -> String {
  let c: Vec<char> = s.chars().collect();
  let end_of_part = |k: usize| k == c.len() || js_space(c[k]) || matches!(c[k], ')' | '\'' | '"' | '<' | '>');
  // `:digits` once or twice, then the end of the part.
  let line_col = |k: usize| {
    let digits = |mut k: usize| {
      let start = k;
      while k < c.len() && c[k].is_ascii_digit() {
        k += 1;
      }
      (k > start).then_some(k)
    };
    let group = |k: usize| if k < c.len() && c[k] == ':' { digits(k + 1) } else { None };
    match group(k) {
      Some(one) => group(one).is_some_and(end_of_part) || end_of_part(one),
      None => false,
    }
  };
  let scheme = |p: usize| {
    ["https://", "http://", "file://"].into_iter().find_map(|sch| {
      let n = sch.chars().count();
      let matches = p + n <= c.len() && c[p..p + n].iter().zip(sch.chars()).all(|(a, b)| a.to_ascii_lowercase() == b);
      matches.then_some(n)
    })
  };
  let mut out = String::with_capacity(s.len());
  let (mut copied, mut p) = (0, 0);
  while p < c.len() {
    let boundary = !word(if p == 0 { None } else { c.get(p - 1) });
    let Some(n) = scheme(p).filter(|_| boundary) else {
      p += 1;
      continue;
    };
    let mut j = p + n;
    while j < c.len() && !js_space(c[j]) && !matches!(c[j], '?' | '#' | '\'' | '"' | '<' | '>') {
      j += 1;
    }
    if j == c.len() || !matches!(c[j], '?' | '#') {
      p += 1;
      continue;
    }
    // Lazily up to the first place the lookahead holds; a '(' on the way ends the attempt.
    let mut k = j + 1;
    let found = loop {
      if line_col(k) || end_of_part(k) {
        break Some(k);
      }
      if c[k] == '(' {
        break None;
      }
      k += 1;
    };
    match found {
      Some(k) => {
        out.extend(&c[copied..j]);
        copied = k;
        p = k;
      }
      None => p += 1,
    }
  }
  out.extend(&c[copied..]);
  out
}

/// `value` as one line of text with everything personal masked, at most `max` characters.
pub fn text(value: &str, max: usize) -> String {
  let mut s = strip_queries(utf16_prefix(value, 4000));
  for rule in RULES.iter() {
    s = apply(rule, &s);
  }
  let s = js_trim(&SPACES.replace_all(&s, " ")).to_string();
  if utf16_len(&s) > max { format!("{}…", utf16_prefix(&s, max - 1)) } else { s }
}

/// A stack frame's location: folders and URLs masked, line and column kept.
fn frame(line: &str) -> String {
  let mut s = strip_queries(utf16_prefix(js_trim(line), 400));
  for rule in &RULES[..2] {
    s = apply(rule, &s);
  }
  s
}

/// An error made safe to send.
#[derive(Debug, Clone, PartialEq)]
pub struct Scrubbed {
  pub name: String,
  pub message: String,
  pub stack: String,
}

/// JavaScript's String(value), for what is not an object.
fn js_string(v: &Value) -> String {
  match v {
    Value::String(s) => s.clone(),
    Value::Bool(b) => b.to_string(),
    Value::Number(n) => n.to_string(),
    _ => String::new(),
  }
}

/// An error made safe to send: its class name, the message through text(),
/// and only the stack's "at …" frames (the stack's first lines repeat the raw
/// message, so they are rebuilt from the scrubbed one). Accepts an object
/// shaped like an Error (from the page, the route handlers, the shell), or
/// anything else.
pub fn error(raw: &Value) -> Option<Scrubbed> {
  if raw.is_null() {
    return None;
  }
  let object = raw.as_object();
  let is_object = object.is_some() || raw.is_array();
  let field = |k: &str| object.and_then(|o| o.get(k)).and_then(Value::as_str);
  let name = field("name").filter(|n| ERROR_NAME.is_match(n)).unwrap_or("Error").to_string();
  let raw_message = if is_object { field("message").unwrap_or("").to_string() } else { js_string(raw) };
  let message = text(&raw_message, MAX_MESSAGE);
  let frames: Vec<String> = field("stack")
    .map(|stack| stack.split('\n').filter(|l| FRAME_LINE.is_match(l)).take(MAX_FRAMES).map(frame).collect())
    .unwrap_or_default();
  let mut stack = format!("{name}: {message}");
  for f in &frames {
    stack.push_str("\n    ");
    stack.push_str(f);
  }
  Some(Scrubbed { name, message, stack })
}

/// What a field may hold.
#[derive(Clone, Copy, Debug)]
pub enum Kind {
  Bool,
  /// A whole number from 0 to a billion, rounded.
  Int,
  /// A Bankleitzahl: eight digits.
  Blz,
  Version,
  /// A code word: a route, a screen, a TAN method's id. Never a sentence.
  Id,
  /// One of these values.
  OneOf(&'static [&'static str]),
}

pub type Spec = &'static [(&'static str, Kind)];

static VERSION: LazyLock<Regex> = LazyLock::new(|| re(r"^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}(?:-[A-Za-z0-9_.]{1,32})?$"));
static ID: LazyLock<Regex> = LazyLock::new(|| re(r"^[A-Za-z0-9_.:/-]{1,64}$"));

/// JavaScript's Math.round: halves up, towards +∞.
pub fn js_round(v: f64) -> f64 {
  let f = v.floor();
  if v - f >= 0.5 { f + 1.0 } else { f }
}

/// A whole number as JavaScript would write it into JSON: no ".0".
pub fn whole(v: f64) -> Value {
  if v.abs() < 9_007_199_254_740_992.0 { Value::from(v as i64) } else { Value::from(v) }
}

fn kept(kind: Kind, v: &Value) -> Option<Value> {
  match kind {
    Kind::Bool => v.as_bool().map(Value::from),
    Kind::Int => v.as_f64().filter(|n| n.is_finite()).map(|n| whole(js_round(n).clamp(0.0, 1e9))),
    Kind::Blz => v.as_str().filter(|s| s.len() == 8 && s.bytes().all(|b| b.is_ascii_digit())).map(Value::from),
    Kind::Version => v.as_str().filter(|s| VERSION.is_match(s)).map(Value::from),
    Kind::Id => v.as_str().filter(|s| ID.is_match(s)).map(Value::from),
    Kind::OneOf(allowed) => v.as_str().filter(|s| allowed.contains(s)).map(Value::from),
  }
}

/// Only the fields `spec` declares, each of its type.
pub fn props(raw: &Value, spec: Spec) -> Map<String, Value> {
  let mut out = Map::new();
  let Some(raw) = raw.as_object() else { return out };
  for (key, kind) in spec {
    if let Some(v) = raw.get(*key).and_then(|v| kept(*kind, v)) {
      out.insert((*key).to_string(), v);
    }
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn t(s: &str) -> String {
    text(s, MAX_MESSAGE)
  }

  #[test]
  fn text_ibans_with_and_without_spaces() {
    assert_eq!(t("Konto DE89370400440532013000 gesperrt"), "Konto [IBAN] gesperrt");
    assert_eq!(t("an DE89 3704 0044 0532 0130 00."), "an [IBAN].");
    // JavaScript's \b is ASCII: a letter like ä after the IBAN still ends it.
    assert_eq!(t("DE89370400440532013000ä"), "[IBAN]ä");
  }

  #[test]
  fn text_amounts_dates_and_long_numbers() {
    assert_eq!(t("Betrag 1.234,56 EUR überschreitet Limit"), "Betrag [Betrag] EUR überschreitet Limit");
    assert_eq!(t("49,99 und 12.50"), "[Betrag] und [Betrag]");
    assert_eq!(t("gebucht am 05.10.2026 und 2026-10-05"), "gebucht am [Datum] und [Datum]");
    assert_eq!(t("Konto 0532013000 bei 37040044"), "Konto [Zahl] bei [Zahl]");
  }

  #[test]
  fn text_short_codes_stay_they_say_what_went_wrong() {
    assert_eq!(t("HIRMS 9942: PIN falsch"), "HIRMS 9942: PIN falsch");
    assert_eq!(t("request failed with status code 503"), "request failed with status code 503");
  }

  #[test]
  fn text_names_after_a_label_and_quoted_text_are_masked() {
    assert_eq!(t("Name des Zahlungsempfängers weicht ab. Empfänger: Max Mustermann"), "Name […]. Empfänger: […]");
    assert_eq!(t("Kontoinhaber Erika Musterfrau; bitte prüfen"), "Kontoinhaber […]; bitte prüfen");
    // The label rule is the stricter one and wins: what follows "Name" goes.
    assert_eq!(t("Der Name „Erika Musterfrau“ passt nicht"), "Der Name […]");
    assert_eq!(t("Der Wert „Erika Musterfrau“ passt nicht"), "Der Wert \"…\" passt nicht");
    assert_eq!(t("Verwendungszweck: Miete Oktober"), "Verwendungszweck: […]");
    assert_eq!(t("EMPFÄNGER: Max"), "EMPFÄNGER: […]");
  }

  #[test]
  fn text_a_quoted_code_word_stays() {
    assert_eq!(t("Cannot read properties of undefined (reading 'amount')"), "Cannot read properties of undefined (reading 'amount')");
    assert_eq!(t("\"Erika Musterfrau\" is not a function"), "\"…\" is not a function");
  }

  #[test]
  fn text_e_mail_home_folders_url_queries() {
    assert_eq!(t("mail to max@example.org failed"), "mail to [E-Mail] failed");
    assert_eq!(t("ENOENT C:\\Users\\ninob\\AppData\\Roaming\\x"), "ENOENT C:\\Users\\~\\AppData\\Roaming\\x");
    assert_eq!(t("open /home/erika/file"), "open /home/~/file");
    assert_eq!(t("GET https://bank.example/fints?user=erika&pin=1 → 500"), "GET https://bank.example/fints → 500");
  }

  /// What electron/telemetry-scrub.cjs itself makes of these (run under Node, 2026-11-06).
  #[test]
  fn text_as_the_javascript_scrubber_writes_it() {
    let cases = [
      // The URL rule's lookahead: up to a ":line:col" at the end of the part, a space, a quote or a bracket.
      ("at HTTPS://x.example/a.js?v=1#top:10:2)", "at HTTPS://x.example/a.js:10:2)"),
      // The query goes, then the quoted text that is left is no code word.
      ("see 'https://x.example/?q=a'", "see \"…\""),
      ("see https://x.example/?q=a)", "see https://x.example/)"),
      ("https://x.example/#frag", "https://x.example/"),
      ("go to file:///C:/x?y=1:5 now", "go to file:///C:/x:5 now"),
      // A ':' with digits inside the query is the query's, not a line number.
      ("https://x.example/p?a=1:2:3x", "https://x.example/p"),
      // A '(' in the query: the rule does not apply there.
      ("https://x.example/p?a=(1)", "https://x.example/p?a=(1)"),
      // Only where a word starts.
      ("xhttps://x.example/p?a=b", "xhttps://x.example/p?a=b"),
      ("two https://a.example/?x and https://b.example/#y", "two https://a.example/ and https://b.example/"),
      // JavaScript's \b is ASCII: a letter like ä after the IBAN still ends it.
      ("DE89370400440532013000ä", "[IBAN]ä"),
      ("EMPFÄNGER: Max", "EMPFÄNGER: […]"),
      ("Zahlungsempfängername Erika", "Zahlungsempfänger[…]"),
      ("Inhaberin: Erika Muster. Rest", "Inhaberin: […]. Rest"),
      ("ID 2026-10-05T10:00:00.000Z done", "ID [Datum] done"),
      ("at foo (/Users/erika/app.js:1:2)", "at foo (/Users/~/app.js:1:2)"),
      ("C:/users/Erika/x and c:\\USERS\\bob\\y", "C:/users/~/x and c:\\USERS\\~\\y"),
      ("payee=John Doe; next", "payee=[…]; next"),
      ("Konto\u{a0}DE89 3704 0044 0532 0130 00", "Konto [IBAN]"),
      ("a\u{2028}b\u{a0}\u{a0}c\u{feff}", "a b c"),
      ("‚Erika‘ und «Max» und „ok“", "‚Erika‘ und «Max» und „ok“"),
      ("token 'a.b.c' and \"$x\"", "token 'a.b.c' and \"$x\""),
      ("12345 1234 1.234 1.234.567,89 3,5 3,50", "[Zahl] 1234 [Betrag] [Betrag] 3,5 [Betrag]"),
      ("mail: first.last+tag@sub.example.co.uk!", "mail: [E-Mail]!"),
    ];
    for (input, js) in cases {
      assert_eq!(t(input), js, "{input}");
    }
    // Capped by UTF-16 units, as JavaScript counts…
    let emoji_last = format!("{}😀", "x".repeat(299));
    assert_eq!(t(&emoji_last), format!("{}…", "x".repeat(299)));
    // …except that the cut never splits a character: JavaScript leaves half an emoji there.
    let emoji_at_cut = format!("{}😀y", "x".repeat(298));
    assert_eq!(t(&emoji_at_cut), format!("{}…", "x".repeat(298)));
    // The frames: any of JavaScript's spaces before "at", and after it.
    let e = error(&json!({ "name": "Error", "message": "x", "stack": "Error: x\n\u{a0} at a (C:\\Users\\nino\\f.js?x=1:2:3)\n\tat\tb\n  atc" })).unwrap();
    assert_eq!(e.stack, "Error: x\n    at a (C:\\Users\\~\\f.js?x=1:2:3)\n    at\tb");
  }

  #[test]
  fn text_one_line_capped() {
    assert_eq!(t("a\n\n  b\tc"), "a b c");
    let long = t(&"x".repeat(1000));
    assert_eq!(utf16_len(&long), MAX_MESSAGE);
    assert!(long.ends_with('…'));
  }

  #[test]
  fn error_the_stack_is_rebuilt_from_the_scrubbed_message_and_its_frames() {
    let raw = json!({
      "name": "TypeError",
      "message": "Empfänger: Max Mustermann, DE89370400440532013000",
      "stack": "TypeError: Empfänger: Max Mustermann, DE89370400440532013000\n  second line of the message with 49,99\n    at pay (C:\\Users\\ninob\\AppData\\Local\\Programs\\Girovo\\resources\\server\\x.js:12:34)\n    at http://127.0.0.1:51234/_next/static/app.js?v=abc:1:999",
    });
    let e = error(&raw).unwrap();
    assert_eq!(e.name, "TypeError");
    assert_eq!(e.message, "Empfänger: […]");
    assert_eq!(
      e.stack,
      "TypeError: Empfänger: […]\n    at pay (C:\\Users\\~\\AppData\\Local\\Programs\\Girovo\\resources\\server\\x.js:12:34)\n    at http://127.0.0.1:51234/_next/static/app.js:1:999"
    );
    assert!(!e.stack.contains("49,99"));
  }

  #[test]
  fn error_odd_input() {
    assert_eq!(error(&Value::Null), None);
    assert_eq!(error(&json!("boom 0532013000")).unwrap().message, "boom [Zahl]");
    assert_eq!(error(&json!({ "name": "not a name!", "message": "x" })).unwrap().name, "Error");
    assert_eq!(error(&json!({ "name": "RangeError", "message": "bad" })).unwrap().name, "RangeError");
    assert_eq!(error(&json!({ "message": 5 })).unwrap().message, "");
    assert_eq!(error(&json!([1, 2])).unwrap().message, "");
  }

  #[test]
  fn props_only_declared_fields_each_of_its_type() {
    const SPEC: Spec = &[
      ("blz", Kind::Blz),
      ("ok", Kind::Bool),
      ("ms", Kind::Int),
      ("screen", Kind::Id),
      ("format", Kind::OneOf(&["pdf", "csv"])),
      ("from", Kind::Version),
    ];
    let out = props(
      &json!({
        "blz": "37040044", "ok": true, "ms": 182.6, "screen": "umsaetze", "format": "pdf", "from": "4.3.0",
        "iban": "DE89370400440532013000", "extra": 1,
      }),
      SPEC,
    );
    assert_eq!(Value::Object(out), json!({ "blz": "37040044", "ok": true, "ms": 183, "screen": "umsaetze", "format": "pdf", "from": "4.3.0" }));
  }

  #[test]
  fn props_free_text_never_rides_along() {
    const SPEC: Spec = &[("screen", Kind::Id), ("blz", Kind::Blz), ("format", Kind::OneOf(&["pdf", "csv"])), ("ms", Kind::Int)];
    assert!(props(&json!({ "screen": "Max Mustermann", "blz": "3704 0044", "format": "docx", "ms": "12" }), SPEC).is_empty());
    assert!(props(&Value::Null, SPEC).is_empty());
    assert_eq!(Value::Object(props(&json!({ "ms": -5 }), SPEC)), json!({ "ms": 0 }));
    assert_eq!(Value::Object(props(&json!({ "ms": 2.5 }), SPEC)), json!({ "ms": 3 }));
  }

  #[test]
  fn js_round_is_javascripts() {
    assert_eq!(js_round(2.5), 3.0);
    assert_eq!(js_round(-2.5), -2.0);
    assert_eq!(js_round(0.49999999999999994), 0.0);
    assert_eq!(js_round(99.6), 100.0);
  }
}
