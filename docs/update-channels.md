# Update channels from girovo.de

Planned for 6.2.0 (owner, 2026-11-11; first named 6.1.2). Until now the updaters knew two
channels, Stabil and Nightly, written into the app. From 6.2.0 on, girovo.de
can add channels (the first one is Girovo Next) without an app update.

The rule over all of it: **girovo.de decides what is offered, the app decides
what is trusted.** The keys an update may be signed with are built into the
app. A channel list from girovo.de can only point at those keys, and the list
itself must be signed with the stable key.

The owner's picks (2026-11-11): the Nightly channel keeps its name; Next is in
the list but hidden while it has no builds; the stable key signs the list; one
key for Next and two reserve keys are built in now.

## Key roles

| Role | Signs | Secret half |
| --- | --- | --- |
| `stable` | releases, the channel list | owner's keys folder, password |
| `nightly` | nightlies, hand-made previews | Actions secret `GIROVO_NIGHTLY_SIGNING_KEY` |
| `next` | Girovo Next builds | owner's keys folder, no password (an Actions secret once Next builds start) |
| `reserve1`, `reserve2` | a channel added later | owner's keys folder, password |

Key ids: stable `db00cdc657dd9421`, nightly `bc7687ce7912473c` (2026-11-07),
next `4783eb4473d8281e`, reserve1 `148e76a8a204a6e8`, reserve2
`02c48bf0ff17f160` (2026-11-11).

The public halves are in `mobile/updates/update-keys.ts` and
`src-tauri/src/updater/trust.rs`, identical. An empty key trusts nothing. A
`.sig` names its key by id (first 8 bytes of SHA-256 of the public key, hex),
as before.

## Which update a channel takes

Every channel has a set of key roles (`keys`) and a manifest name
(`manifest`). A manifest signed by role `R` whose `channel` field is `M` may be
offered on channel `C` only when all of these hold:

1. `R` is in `C.keys`.
2. `M` is `"stable"` or `C.manifest`.
3. `M` is `"stable"` only when `R` is `stable`.

A manifest without a string `channel` field counts as `M = "stable"` when
signed by `stable`, `M = "nightly"` when signed by `nightly`, and is refused
for any other role. (Every manifest so far carries the field; this is for
safety.)

A file the user picks or drops (no channel to go by): the `stable` key may
sign any version, every other key only a pre-release (by build number).

`scripts/update-manifest.mjs` writes `channel`: `"next"` for a tag with
`-next.`, `"nightly"` for any other pre-release tag, `"stable"` otherwise;
`--channel <id>` overrides.

## Build numbers

Unchanged, with one widening: a pre-release `X.Y.Z-<word>.<yyyymmddhhmm>[.g<sha>]`
is numbered like a nightly for any `<word>` matching `[a-z][a-z0-9]{1,15}`
(so `nightly`, the old `preview.<stamp>` and `next` alike). `preview.N`
(N = 1–99) and the `-dev` suffix stay as they are. Same change in
update-trust.ts, trust.rs and the Worker.

Copies up to 6.1.1 know neither the `next` key nor `next.<stamp>` numbers, so
they can never be offered a Next build, not even through the GitHub fallback.

## Built-in channels

| id (stored value) | shown as | keys | manifest | listing | pre-releases | usage data |
| --- | --- | --- | --- | --- | --- | --- |
| `stable` | Stabil | stable | stable | `stable.json` | no | no |
| `preview` | Nightly | stable, nightly | nightly | `nightly.json` | yes | required |

The list cannot change these two. Their names and hints come from the app's
own texts (lib/i18n).

## The channel list

`GET https://girovo.de/updates/v1/channels.json` answers an envelope:

```json
{ "format": "girovo-channels", "v": 1, "list": "<the signed text>", "sig": "<a .sig file's text>" }
```

`sig` is an ordinary `.sig` object (`format: "girovo-update-sig"`, `v: 1`,
`key`, `sig`), an Ed25519 signature over the bytes of
`"girovo-channels/1\n"` followed by the UTF-8 bytes of `list`, by the
**stable** key only. The different prefix keeps a release signature from ever
passing as a list signature and the other way round.

`list` is JSON:

```json
{
  "format": "girovo-channel-list",
  "v": 1,
  "serial": 1,
  "channels": [
    {
      "id": "next",
      "keys": ["stable", "next"],
      "usage": true,
      "hidden": true,
      "platforms": ["desktop"],
      "then": "stable",
      "name": { "de": "Next", "en": "Next" },
      "hint": { "de": "Vorschau auf die nächste große Version.", "en": "A preview of the next major version." }
    }
  ]
}
```

Reading it, field by field (anything not fitting drops that entry, not the
list; unknown fields are ignored; at most the first 8 entries count; an entry
whose id any earlier entry had, valid or not, is dropped):

- `serial`: a safe integer ≥ 1. A list is taken only when its serial is at
  least the serial of the list the app already holds, so an old signed list
  can't be served again to bring back a channel.
- `id`: `^[a-z][a-z0-9]{1,15}$`, not `stable`, `preview` or `nightly`. It is
  the stored channel value, the listing (`<id>.json`) and the manifest name.
- `keys`: a non-empty array of role names from the table above.
- `usage` (default `true`): choosing the channel requires usage data, as Nightly does.
- `hidden` (default `false`): not shown in Update-Kanal unless it is the
  current channel.
- `platforms` (default `["desktop"]`): a non-empty array of `"desktop"`,
  `"apk"`; an empty array or another value drops the entry. On another
  platform the entry counts as absent, unless it is ended.
- `ended` (default `false`) and `then` (default `"stable"`; `"stable"`,
  `"preview"` or another id in the list, else the entry is dropped): a copy on
  an ended channel moves to `then`, as if the user had picked it
  (set_channel: the way back is offered). An ended entry counts on every
  platform, whatever `platforms` says. A copy whose channel is absent from
  the list moves to `stable`.
- `name`: `de` and `en`, 1–24 characters each. `hint`: `de` and `en`, 0–120
  characters each, both present (a missing `hint` is empty).

Every list channel offers pre-releases, asks `<id>.json` on girovo.de, and in
the GitHub fallback reads the list of releases like Nightly, taking only what
passes the rule above. On Nightly and list channels the fallback tries the
newest three releases by build number and takes the first that fits, so a
Next build at the top of GitHub's list doesn't leave Nightly copies with
nothing during an outage.

## In the app

- **Fetch**: at each update check (at start and every six hours), before the
  offer. A failed fetch keeps the list held. Held as the envelope's text in
  `fints.updates.channels` (desktop prefs) or the same key in the APK's
  storage.
- **Stored channel** (`fints.updates.channel` on the desktop,
  `fints.updateChannel` in the APK, the keys they already had): `stable`, `preview` or a list
  id. A list id the held list doesn't have (or for another platform, or
  ended) is handled as above. With no list held at all, a list id is checked
  as `stable`, the state reports `stable`, and the stored value stays until a
  list arrives.
- **State to the page**: `channel` is the id; `channels` is the list to offer:
  `stable`, `preview`, then the list's channels for this platform that are
  neither hidden nor ended, plus the current one if it is hidden.
  Each: `{ id, builtin, usage, name?: {de, en}, hint?: {de, en} }` (built-ins
  without name and hint).
- **setChannel(id)**: takes `stable`, `preview` or a list id that is offered
  or current; anything else is ignored and the state comes back unchanged.
- The note of what girovo.de offered last (`fints.updates.listed`) is keyed by
  the channel id, as it already is for `stable` and `preview`.
- The move of Nightly copies to Stabil after 6.0.0 (moves_to_stable,
  keeps_nightly) stays about `preview` only.

## On girovo.de (girovo-website, src/updates.ts)

- The signed envelope is a file in the repo (`src/channels.json`), served at
  `/updates/v1/channels.json` with an ETag and the listings' cache time.
- Listings: `stable`, `nightly`, and every id in the bundled list that is not
  ended. A listing for channel `C` takes releases whose manifest `channel` is
  `"stable"` or `C`'s manifest name (`nightly` for `nightly.json`), so
  `nightly.json` never lists a Next build. `stable.json` still takes only tags
  without `-`.
- The Worker's buildNumber gets the same widening as the apps'.

## Scripts

- `node scripts/sign-update.mjs sign-channels <list.json> --key <stable key> [--out channels.json]`
  checks the list against the rules above and writes the envelope. The owner
  types the password, as for a release.
- `node scripts/sign-update.mjs verify-channels <channels.json>` checks an
  envelope against the built-in keys.

## Test file

`mobile/updates/__fixtures__/channels-test.json` is an envelope signed with
the test secret key `[1; 32]` (public `iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=`,
used as the `stable` key in tests). Both halves' tests read it. Serial 3.
Read on the desktop it gives `next` (hidden), `api` and `old` (ended, then
`preview`); on the APK `api`, `old` (ended counts everywhere) and `apkonly`. Dropped everywhere: `Bad`
(id), `nokeys` (no keys), the second `api` (duplicate).

## Not yet

- No Next builds: nightly.yml gets no `next` choice until the owner starts
  them. Then: the `next` key as an Actions secret, a `girovo-next` branch, an
  edition name ("Girovo Next") and icon, and `hidden: false` in a new list
  (serial 2).
- The privacy policy should speak of pre-release channels in general before
  Next becomes visible.
