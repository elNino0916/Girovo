// The tools an assistant sees, each one Girovo API method (docs/girovo-api.md):
// its name, the permission Girovo checks, what it takes (a JSON Schema whose
// properties are the method's own parameters, passed on as they are) and the
// short line that heads its answer.
//
// The line only counts and quotes what the method answered: amounts are
// Girovo's own cents, written out, never worked out or rounded here. The
// method's JSON follows it in full.

use std::collections::BTreeSet;

use serde_json::{Map, Value, json};

pub struct Tool {
  pub name: &'static str,
  pub title: &'static str,
  /// The Girovo API method, with its `girovo.` prefix.
  pub method: &'static str,
  /// What Girovo has to allow for it.
  pub permission: &'static str,
  /// Reads only: nothing in Girovo changes.
  pub read_only: bool,
  pub description: &'static str,
  /// The input's properties and the required ones.
  schema: fn() -> (Value, &'static [&'static str]),
}

impl Tool {
  pub fn input_schema(&self) -> Value {
    let (properties, required) = (self.schema)();
    let mut schema = json!({ "type": "object", "properties": properties, "additionalProperties": false });
    if !required.is_empty() {
      schema["required"] = json!(required);
    }
    schema
  }

  /// The arguments as the method's params: only the properties the schema names.
  pub fn params(&self, args: &Map<String, Value>) -> Value {
    let (properties, _) = (self.schema)();
    let known = properties.as_object().cloned().unwrap_or_default();
    Value::Object(args.iter().filter(|(k, _)| known.contains_key(*k)).map(|(k, v)| (k.clone(), v.clone())).collect())
  }

  /// The entry in tools/list. `granted`: what Girovo allows this assistant so
  /// far, None before the first answer from Girovo.
  pub fn listed(&self, granted: Option<&BTreeSet<String>>) -> Value {
    let mut description = self.description.to_string();
    if let Some(granted) = granted {
      if !granted.contains(self.permission) {
        description.push_str(" Not allowed yet: the first use asks the user in Girovo.");
      }
    }
    json!({
      "name": self.name,
      "title": self.title,
      "description": description,
      "inputSchema": self.input_schema(),
      "annotations": {
        "title": self.title,
        "readOnlyHint": self.read_only,
        "destructiveHint": false,
        "idempotentHint": self.read_only,
        "openWorldHint": self.method == "girovo.bank.refresh" || self.method == "girovo.transfers.request",
      },
    })
  }
}

pub fn find(name: &str) -> Option<&'static Tool> {
  TOOLS.iter().find(|t| t.name == name)
}

/// Permissions the first hello asks for, beside the one the first tool needs.
pub const DEFAULT_PERMISSIONS: [&str; 3] = ["accounts.read", "transactions.read", "insights.read"];

fn none() -> (Value, &'static [&'static str]) {
  (json!({}), &[])
}

fn s(description: &str) -> Value {
  json!({ "type": "string", "description": description })
}

const ID_ACCOUNT: &str = "An account id from list_accounts (\"a_…\").";
const ID_BOOKING: &str = "A booking id from search_transactions (\"t_…\").";
const ID_CONTRACT: &str = "A contract id from list_contracts (\"c_…\").";
const ID_CATEGORY: &str = "A category id as Girovo's answers give it (category.id).";
const MONTH: &str = "Month as yyyy-mm; this month when left out.";

pub static TOOLS: &[Tool] = &[
  Tool {
    name: "list_accounts",
    title: "Konten",
    method: "girovo.accounts.list",
    permission: "accounts.read",
    read_only: true,
    description: "Lists the user's accounts in Girovo (Konten) with balance (Saldo), available amount (Verfügbar), IBAN and bank, and the total balance (Gesamtsaldo) per currency. Amounts are cents with a currency.",
    schema: none,
  },
  Tool {
    name: "search_transactions",
    title: "Umsätze suchen",
    method: "girovo.transactions.list",
    permission: "transactions.read",
    read_only: true,
    description: "Searches the bookings Girovo has loaded (Umsätze), newest first, with category, note and split. Filter by account, days, a search text (payee, purpose, note, amount) and category. At most `limit` (1 to 500, default 100); `next` in the answer is the cursor for more. Amounts are cents; negative is money going out.",
    schema: || {
      (
        json!({
          "account": s(ID_ACCOUNT),
          "from": s("First day, yyyy-mm-dd."),
          "to": s("Last day, yyyy-mm-dd."),
          "query": s("Search text, as Girovo's own search takes it."),
          "category": s(ID_CATEGORY),
          "limit": { "type": "integer", "minimum": 1, "maximum": 500, "description": "How many, 100 when left out." },
          "cursor": s("The `next` of the answer before, for the bookings after it."),
        }),
        &[],
      )
    },
  },
  Tool {
    name: "month_summary",
    title: "Monat im Überblick",
    method: "girovo.insights.month",
    permission: "insights.read",
    read_only: true,
    description: "One month as Girovo's Analyse shows it: income (Einnahmen), spending (Ausgaben), net, and both by category, over the loaded accounts. Transfers between own accounts are left out. `coverage` says whether the whole month is loaded.",
    schema: || (json!({ "month": s(MONTH) }), &[]),
  },
  Tool {
    name: "list_contracts",
    title: "Verträge und Abos",
    method: "girovo.contracts.list",
    permission: "insights.read",
    read_only: true,
    description: "The contracts and subscriptions Girovo found (Verträge & Abos): amount, cadence, per month and per year, next and last day, price changes.",
    schema: none,
  },
  Tool {
    name: "list_budgets",
    title: "Budgets",
    method: "girovo.budgets.list",
    permission: "insights.read",
    read_only: true,
    description: "The monthly budgets (Monatsbudgets) against that month's spending: budget, spent, rest and state (left, exact, over, unknown).",
    schema: || (json!({ "month": s(MONTH) }), &[]),
  },
  Tool {
    name: "list_savings_goals",
    title: "Sparziele",
    method: "girovo.goals.list",
    permission: "insights.read",
    read_only: true,
    description: "The savings goals (Sparziele) on savings accounts: target, by when, the account's balance and what is missing.",
    schema: none,
  },
  Tool {
    name: "set_booking_category",
    title: "Kategorie setzen",
    method: "girovo.categories.set",
    permission: "categories.write",
    read_only: false,
    description: "Files one booking under a category, as the user would in Girovo. category null puts it back to the rule or Girovo's guess.",
    schema: || {
      (
        json!({
          "booking": s(ID_BOOKING),
          "category": { "type": ["string", "null"], "description": "A category id, or null." },
        }),
        &["booking", "category"],
      )
    },
  },
  Tool {
    name: "add_category_rule",
    title: "Regel für einen Empfänger",
    method: "girovo.rules.add",
    permission: "categories.write",
    read_only: false,
    description: "Files every booking of a payee under a category from now on, as Girovo's \"Immer so einordnen\" does. Give a booking (its payee) or the payee's name. A payee the user filed by hand is left alone.",
    schema: || {
      (
        json!({
          "booking": s(ID_BOOKING),
          "payee": s("The payee's name, when no booking is given."),
          "category": s(ID_CATEGORY),
        }),
        &["category"],
      )
    },
  },
  Tool {
    name: "create_category",
    title: "Eigene Kategorie",
    method: "girovo.categories.create",
    permission: "categories.write",
    read_only: false,
    description: "Makes an own category for spending (out) or income (in) and answers its id.",
    schema: || {
      (
        json!({
          "name": s("The category's name."),
          "direction": { "type": "string", "enum": ["out", "in"], "description": "out (spending, the default) or in (income)." },
        }),
        &["name"],
      )
    },
  },
  Tool {
    name: "set_note",
    title: "Notiz",
    method: "girovo.notes.set",
    permission: "notes.write",
    read_only: false,
    description: "Writes the note on a booking (one line, up to 280 characters). text null removes it.",
    schema: || {
      (
        json!({
          "booking": s(ID_BOOKING),
          "text": { "type": ["string", "null"], "description": "The note, or null." },
        }),
        &["booking", "text"],
      )
    },
  },
  Tool {
    name: "set_budget",
    title: "Monatsbudget",
    method: "girovo.budgets.set",
    permission: "budgets.write",
    read_only: false,
    description: "Sets the monthly budget (Monatsbudget) of a spending category, in cents. cents null removes it.",
    schema: || {
      (
        json!({
          "category": s(ID_CATEGORY),
          "cents": { "type": ["integer", "null"], "minimum": 1, "description": "The budget in cents (12000 is 120,00 €), or null." },
        }),
        &["category", "cents"],
      )
    },
  },
  Tool {
    name: "set_savings_goal",
    title: "Sparziel",
    method: "girovo.goals.set",
    permission: "budgets.write",
    read_only: false,
    description: "Sets the savings goal (Sparziel) of a savings account: a name, the target in cents and optionally a month to reach it by. target null removes it.",
    schema: || {
      (
        json!({
          "account": s(ID_ACCOUNT),
          "name": s("The goal's name."),
          "target": { "type": ["integer", "null"], "minimum": 1, "description": "The target in cents, or null." },
          "by": { "type": ["string", "null"], "description": "Month to reach it by, yyyy-mm." },
        }),
        &["account", "target"],
      )
    },
  },
  Tool {
    name: "set_reminder",
    title: "Erinnerung",
    method: "girovo.reminders.set",
    permission: "budgets.write",
    read_only: false,
    description: "Sets a reminder for a contract, for example to cancel it by a day; Girovo reminds the user `lead` days before. by null removes it.",
    schema: || {
      (
        json!({
          "contract": s(ID_CONTRACT),
          "by": { "type": ["string", "null"], "description": "The day, yyyy-mm-dd, or null." },
          "lead": { "type": "integer", "enum": [7, 14, 30], "description": "Days ahead: 7, 14 or 30." },
        }),
        &["contract", "by"],
      )
    },
  },
  Tool {
    name: "rename_contract",
    title: "Vertrag umbenennen",
    method: "girovo.contracts.rename",
    permission: "budgets.write",
    read_only: false,
    description: "Gives a contract its own name in Girovo. name null goes back to the name Girovo found.",
    schema: || {
      (
        json!({
          "contract": s(ID_CONTRACT),
          "name": { "type": ["string", "null"], "description": "The name, or null." },
        }),
        &["contract", "name"],
      )
    },
  },
  Tool {
    name: "get_settings",
    title: "Einstellungen lesen",
    method: "girovo.settings.get",
    permission: "settings.read",
    read_only: true,
    description: "Girovo's settings an app may read and change, with their values; onlyOn and onlyOff name the ones that can be switched one way only.",
    schema: none,
  },
  Tool {
    name: "set_setting",
    title: "Einstellung ändern",
    method: "girovo.settings.set",
    permission: "settings.write",
    read_only: false,
    description: "Changes one of Girovo's settings (keys as get_settings lists them: language, theme, idleMinutes, ai, accountOrder, …). Security, deleting data, the sync and the API itself can only be changed in Girovo.",
    schema: || {
      (
        json!({
          "key": s("The setting's key."),
          "value": {
            "type": ["string", "number", "boolean", "array"],
            "items": { "type": "string" },
            "description": "The new value, of the kind get_settings shows.",
          },
        }),
        &["key", "value"],
      )
    },
  },
  Tool {
    name: "refresh_from_bank",
    title: "Neue Umsätze holen",
    method: "girovo.bank.refresh",
    permission: "bank.refresh",
    read_only: false,
    description: "Has Girovo read new balances and bookings from the bank, for one account or all. If the bank wants an approval (Freigabe), Girovo asks the user, so this can take a while.",
    schema: || (json!({ "account": s(ID_ACCOUNT) }), &[]),
  },
  Tool {
    name: "request_transfer",
    title: "Überweisung vorschlagen",
    method: "girovo.transfers.request",
    permission: "transfers.request",
    read_only: false,
    description: "Proposes a transfer (Überweisung). Nothing is sent: Girovo opens its own transfer form filled in, and only the user can check and send it there, then approve it with the bank. Answers a request id; transfer_status tells how it ended.",
    schema: || {
      (
        json!({
          "iban": s("The recipient's IBAN."),
          "name": s("The recipient's name."),
          "cents": { "type": "integer", "minimum": 1, "description": "The amount in cents (2550 is 25,50 €)." },
          "purpose": s("Purpose (Verwendungszweck)."),
          "executeOn": s("A later day, yyyy-mm-dd, for a scheduled transfer, where the bank offers it."),
          "account": s("The account to send from (an id from list_accounts)."),
        }),
        &["iban", "name", "cents"],
      )
    },
  },
  Tool {
    name: "transfer_status",
    title: "Stand einer Überweisung",
    method: "girovo.transfers.status",
    permission: "transfers.request",
    read_only: true,
    description: "Where a proposed transfer stands: pending (waiting for the user), sent, refused (closed without sending), failed (with the bank's words) or unclear; changed says the user sent other values than proposed.",
    schema: || (json!({ "request": s("The request id request_transfer answered.") }), &["request"]),
  },
];

// ---------------------------------------------------------------------------
// The line above the JSON
// ---------------------------------------------------------------------------

/// Cents as Girovo writes them: "1.234,56 EUR", "-12,30 EUR".
pub fn money(v: &Value) -> Option<String> {
  let cents = v.get("cents")?.as_i64()?;
  let currency = v.get("currency").and_then(Value::as_str).unwrap_or("EUR");
  let sign = if cents < 0 { "-" } else { "" };
  let abs = cents.unsigned_abs();
  let euros = (abs / 100).to_string();
  let mut grouped = String::new();
  for (i, c) in euros.chars().enumerate() {
    if i > 0 && (euros.len() - i) % 3 == 0 {
      grouped.push('.');
    }
    grouped.push(c);
  }
  Some(format!("{sign}{grouped},{:02} {currency}", abs % 100))
}

fn count(v: &Value, key: &str) -> usize {
  v.get(key).and_then(Value::as_array).map_or(0, Vec::len)
}

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
  v.get(key).and_then(Value::as_str)
}

fn coverage_note(v: &Value) -> &'static str {
  match text(v, "coverage") {
    Some("running") => " Der Monat läuft noch.",
    Some("partial") => " Nicht der ganze Monat ist in Girovo geladen.",
    Some("none") => " Für diesen Monat sind keine Umsätze geladen.",
    _ => "",
  }
}

/// One or two sentences on what the method answered.
pub fn summary(tool: &Tool, r: &Value) -> String {
  match tool.method {
    "girovo.accounts.list" => {
      let totals: Vec<String> = r.get("total").and_then(Value::as_array).map(|a| a.iter().filter_map(money).collect()).unwrap_or_default();
      let mut out = format!("{} Konten.", count(r, "accounts"));
      if !totals.is_empty() {
        out.push_str(&format!(" Gesamtsaldo: {}.", totals.join("; ")));
      }
      out
    }
    "girovo.transactions.list" => {
      let mut out = format!("{} Umsätze.", count(r, "transactions"));
      if let Some(next) = text(r, "next") {
        out.push_str(&format!(" Es gibt weitere: cursor \"{next}\"."));
      }
      out
    }
    "girovo.insights.month" => {
      let month = text(r, "month").unwrap_or("?");
      let part = |k: &str| r.get(k).and_then(money).unwrap_or_else(|| "?".into());
      let n = r.get("count").and_then(Value::as_u64).unwrap_or(0);
      format!(
        "{month}: Einnahmen {}, Ausgaben {}, Saldo {} ({n} Umsätze).{}",
        part("income"),
        part("expense"),
        part("net"),
        coverage_note(r)
      )
    }
    "girovo.contracts.list" => format!("{} Verträge und Abos.", count(r, "contracts")),
    "girovo.budgets.list" => {
      let month = text(r, "month").unwrap_or("?");
      let over = r.get("budgets").and_then(Value::as_array).map_or(0, |b| b.iter().filter(|x| text(x, "state") == Some("over")).count());
      let mut out = format!("{month}: {} Budgets", count(r, "budgets"));
      if over > 0 {
        out.push_str(&format!(", {over} davon überschritten"));
      }
      out.push('.');
      out.push_str(coverage_note(r));
      out
    }
    "girovo.goals.list" => format!("{} Sparziele.", count(r, "goals")),
    "girovo.rules.add" => match (r.get("applied").and_then(Value::as_bool), text(r, "reason")) {
      (Some(false), Some("filed_by_hand")) => "Nicht angewendet: diesen Empfänger hat der Nutzer von Hand eingeordnet.".into(),
      (Some(false), Some("already")) => "Diese Regel gab es schon.".into(),
      _ => "Regel gespeichert.".into(),
    },
    "girovo.categories.create" => match r.pointer("/category/id").and_then(Value::as_str) {
      Some(id) => format!("Kategorie angelegt: {id}."),
      None => "Kategorie angelegt.".into(),
    },
    "girovo.settings.get" => format!("{} Einstellungen.", r.get("settings").and_then(Value::as_object).map_or(0, Map::len)),
    "girovo.settings.set" => {
      let key = text(r, "key").unwrap_or("?");
      let value = r.get("value").map(Value::to_string).unwrap_or_default();
      if r.get("changed").and_then(Value::as_bool) == Some(false) {
        format!("{key} war schon {value}.")
      } else {
        format!("{key} ist jetzt {value}.")
      }
    }
    "girovo.bank.refresh" => match r.get("newBookings").and_then(Value::as_u64) {
      Some(n) => format!("Von der Bank gelesen: {n} neue Umsätze."),
      None => "Von der Bank gelesen.".into(),
    },
    "girovo.transfers.request" => format!(
      "Die Überweisung ist in Girovo zur Prüfung geöffnet. Gesendet wird sie erst, wenn der Nutzer sie dort sendet. Anfrage: {}.",
      text(r, "request").unwrap_or("?")
    ),
    "girovo.transfers.status" => {
      let mut out = match text(r, "state") {
        Some("pending") => "Wartet in Girovo auf den Nutzer.".to_string(),
        Some("sent") => "Gesendet: die Bank hat sie angenommen.".to_string(),
        Some("refused") => "Nicht gesendet.".to_string(),
        Some("failed") => "Fehlgeschlagen.".to_string(),
        Some("unclear") => "Status unklar: ob sie angekommen ist, lässt sich noch nicht sagen.".to_string(),
        _ => "Stand unbekannt.".to_string(),
      };
      if let Some(t) = text(r, "text") {
        out.push_str(&format!(" Die Bank meldet: {t}"));
      }
      if r.get("changed").and_then(Value::as_bool) == Some(true) {
        out.push_str(" Der Nutzer hat vor dem Senden etwas geändert.");
      }
      out
    }
    _ => "Gespeichert.".into(),
  }
}
