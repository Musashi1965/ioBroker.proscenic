# ADR 0019: Reliable command delivery and status confirmation

- Status: accepted for test-host validation
- Date: 2026-09-16

## Context

Real-device observation showed that the legacy gateway commonly closes an
adapter socket after roughly 30 seconds and accepts a new socket five seconds
later. This short-lived pushed-event connection is useful for status and map
updates, but it is not the transport used to submit robot commands. Commands use
the separate legacy REST API.

The first adapter implementation nevertheless rejected a command whenever the
last gateway event was considered stale. It also rejected a second command while
the first REST request was in flight and reported only `api-accepted`, leaving
no measurement of the time until the robot reported the requested state. A
temporary REST-session outage therefore caused a user command to be lost rather
than delayed until the bounded reconnect completed.

Owner-local observations on 2026-09-16 showed REST acceptance latencies below
300 milliseconds for the sampled `start`, `pause`, and `return` requests.
Matching status changes normally followed within roughly one to three seconds.
These observations also confirmed that routine gateway socket closure is not
evidence that the command REST session is unavailable.

## Decision

Separate command submission readiness from gateway event-stream freshness:

- an available authenticated REST command session may submit commands even
  while the gateway socket is between its routine short-lived connections;
- if the REST command session is temporarily unavailable, a user command waits
  up to 15 seconds while the adapter expedites the existing bounded cloud
  reconnect path;
- up to five accepted command triggers are serialized in FIFO order; the button
  is acknowledged and reset immediately after the trigger enters this bounded
  queue;
- a REST request is sent at most once. The adapter never automatically repeats
  an ambiguously timed-out mutating request;
- after an HTTP or API failure, the failed command remains failed and the
  adapter renews the cloud session for later commands;
- `start`, `pause`, `continue`, `return`, fan-mode, and deep-cleaning requests
  wait up to 20 seconds for a subsequent matching `20001` status event;
- dust collection remains `api-accepted` because the current status contract
  does not uniquely confirm completion of that multi-stage action;
- `commands.lastResult` progresses through `waiting-for-session`, `sending`,
  `api-accepted`, and then either `status-confirmed` or
  `api-accepted-unconfirmed`; transport or queue failures use `failed`;
- safe diagnostics expose `commands.queueDepth`,
  `commands.lastApiLatencyMs`, and `commands.lastConfirmationLatencyMs`.

The gateway idle watchdog remains responsible for restoring pushed status and
map events. Command handling no longer starts that recovery merely because the
most recent gateway event is old.

## Consequences

Routine gateway socket gaps no longer discard otherwise deliverable commands.
Commands arriving during a short cloud reconnect are delayed and serialized
instead of being lost. The result states now distinguish cloud acceptance from
observable robot confirmation and provide enough timing evidence to diagnose a
vendor-cloud delay without exposing payloads or installation data.

A confirmation timeout is deliberately not treated as proof that the command
failed: the robot or cloud may have acted while the pushed event stream was
unavailable. Likewise, REST acceptance is not presented as physical execution.

## Alternatives Considered

Automatically repeat every unconfirmed command. Rejected because a timeout does
not establish that the first mutating request was not delivered; repeating it
could trigger duplicate or unsafe actions.

Require an active gateway socket before every command. Rejected because live
evidence shows that the socket is routinely closed by the server while the
independent REST session remains usable.

Keep rejecting concurrent writes. Rejected because visualizations and users can
legitimately issue a follow-up command while confirmation of the first one is
still pending; a bounded queue preserves ordering and makes overload explicit.

## Validation

Automated tests cover command-to-status confirmation matching and the public
diagnostic object definitions. Full adapter checks remain mandatory because the
change affects protocol behavior, public objects, acknowledgements, and
reconnect handling.

Test-host validation must record only safe result and latency states. It must
verify a command during an open gateway connection and another during the
normal five-second socket reconnect gap, without recording credentials, tokens,
serial numbers, endpoints, payloads, maps, or private device data.
