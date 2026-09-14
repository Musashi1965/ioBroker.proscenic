# Maintenance protocol findings

Date: 2026-09-14. Scope: the verified M7 Pro legacy backend.

## Evidence and provenance

Owner-local static inspection of ProscenicHome Android 1.5.5 identified exact
read-request contracts. Independently written probes then verified both against
the configured M7 Pro. The source inventory and APK digest are recorded in
`THIRD_PARTY_NOTICES.md`. Raw captures, account identifiers, counter readings,
message history, and all third-party application/firmware artifacts stay ignored.

The application interface metadata supplied method, path, header and form-field
names. The consumable screen supplied counter-unit and lifetime assumptions.
Firmware string inspection independently found the same consumable field names
near its goods-counter handling. No firmware was installed or modified; no
reset or movement request was sent.

## Consumable read request

| Item | Verified contract |
| --- | --- |
| HTTP method/path | `POST /instructions/cmd21015/{sn}` |
| Header | `token` from the authenticated session |
| Encoding | `application/x-www-form-urlencoded` |
| Form | `username` |
| HTTP result | 200, envelope `code=0`, `data=null` |
| Actual values | asynchronous gateway event `infoType=21015` |
| Observed fields | `filter`, `mainBrush`, `sideBrush`, `sensors`, `battery` |

Two successful gateway captures returned identical consumable counters. This
proves that the read request works on the real device. An initial connection
closed before useful events, so the local experiment reauthenticated and retried
with a bound of three attempts. HTTP success alone is not proof of receiving
the counters, and `data=null` is not a failed consumable read.

The four consumables carry **used seconds**, not remaining percentages:

| Field | Component | App maintenance interval |
| --- | --- | --- |
| `filter` | Filter | 150 hours |
| `sideBrush` | Side brush | 200 hours |
| `mainBrush` | Main brush | 300 hours |
| `sensors` | Sensors | 30 hours |

Derived remaining percentage is `100 * (1 - usedSeconds / (intervalHours * 3600))`.
Negative results mean the maintenance interval has been exceeded. Do not lose
this evidence by clamping the raw counter or an overdue diagnostic. A future
display can separately expose a bounded percentage and overdue hours.

The Android version uses whole-hour truncation and clamps overdue displays;
the owner's iOS screenshot shows a negative percentage. Do not promise identical
rounding across applications. Counter values and nominal intervals are the
stable evidence. The additional `battery` field's meaning remains unverified;
it must not be mapped to battery charge or remaining battery life.

The application also identifies `21016` as the counter-reset operation. It was
not sent and is deliberately absent from the read scanner. Robot ownership of
the counters is strongly supported by the request/response flow and firmware
field names; persistence and exact reset semantics remain untested.

## Message history

| Item | Verified contract |
| --- | --- |
| HTTP method/path | `POST /app/cleanRobot/20003/{sn}` |
| Header | `token` |
| Encoding | `application/x-www-form-urlencoded` |
| Form | `username`, `language=EN`, `model=M7`, `page=0`, `size=10` |
| Result | HTTP 200, envelope `code=0`, paginated `data.content` |

The first page returned ten actual events including dust collection and the
dust-bag warning displayed in the owner's app. Entries include a string `code`,
numeric `level`, `msg`, `title`, and time fields, plus private identifiers that
must be removed before any public projection. Page zero is the first page;
pagination metadata is present. Additional pages and other language values have
not yet been tested.

## Message-code conflict

The live backend reports collection start as `6131` and a suspected-full-bag
warning as `6132`. Both have `level=1`. Gateway captures of these codes contained
only the misspelled placeholder `unkonw` as text.

Android 1.5.5 instead labels `6132` as collection completed and `6133` as full
bag. The same code therefore cannot be assigned a universal translation based
only on this old application's table. Prefer the current backend's text and
record model/backend context. Do not derive severity solely from `level=1`, or
interpret every `20003` event as a warning.

Message history is not an active-fault snapshot. A historical warning must not
stay active forever merely because it remains in the history. Gateway events,
`20001.errorState`, latest message, and active maintenance warnings need distinct
freshness and clearing semantics before adapter integration.

## Adapter implementation status

ADR 0017 defines the first adapter object contract for these read paths. The
adapter now:

1. triggers the verified `cmd21015` consumable request after gateway readiness
   and waits for a bounded `21015` gateway event;
2. normalizes the four verified used-second counters into `consumables.*`
   states with interval, remaining percentage, and overdue-hour diagnostics;
3. keeps the unverified `21015.battery` field out of the public object tree;
4. reads the first REST `20003` message-history page and projects only redacted
   safe fields under `status.maintenance.history.*`;
5. keeps historical messages separate from `status.maintenance.hasWarning`.

Open follow-up work remains: active-warning clearing semantics, additional
history pagination, reset-command proof for `21016`, and real-device verification
of the adapter-side refresh after deployment.

This research verifies read protocols and records the first adapter integration
for the verified M7 Pro backend. It does not establish support for other models.
