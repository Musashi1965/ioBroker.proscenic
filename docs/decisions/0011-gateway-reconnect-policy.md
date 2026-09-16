# ADR 0011: Gateway reconnect policy

- Status: accepted for read-only adapter validation
- Date: 2026-09-10

## Context

The first CM4-Node-04 live deployment proved that the adapter can authenticate,
discover the device, connect to the Proscenic gateway, and project status. It
also showed that the gateway socket may close after a short period while the
adapter process remains alive and the robot continues working. Without a
reconnect path, status values become stale.

Commands must not be implemented on top of this unstable read-only transport.
The adapter first needs bounded recovery for gateway socket closure and startup
connection failures.

## Decision

Add a small adapter-owned reconnect policy for the legacy gateway path:

- unexpected gateway close marks `connection.gateway=false`;
- startup connection failure marks cloud and gateway offline and records a
  redacted error;
- normal gateway socket closes are first recovered by reopening only the gateway
  socket with the current token, serial, and gateway endpoint after five
  seconds; this avoids a cloud login/device-list/gateway-discovery loop when
  the gateway closes short-lived sockets after sending events;
- full cloud reconnects are scheduled with bounded exponential backoff starting
  at five seconds and capped at five minutes;
- a successful short-lived gateway connection does not reset the backoff; only
  a connection that remains established for at least five minutes resets the
  reconnect attempt counter;
- if a gateway socket closes before any event was received, or if cached session
  material is missing, the adapter clears the command session and falls back to
  a full cloud reconnect;
- the adapter records `connection.lastGatewayEvent` for the last received
  gateway event and keeps `connection.gatewayIdleReconnectCount` as a bounded
  diagnostic counter;
- if the gateway socket remains technically connected but no gateway event is
  received for 90 seconds, the adapter treats the stream as stale, marks the
  gateway disconnected, closes the socket, clears the command session, and
  schedules a reconnect through the same backoff path;
- only one reconnect timer or connection attempt may be active at a time;
- unload clears the reconnect timer and destroys the socket without scheduling
  recovery;
- no gateway endpoint, token, serial number, raw event, or private payload is
  logged or stored.

The full reconnect reuses the existing login, device selection, gateway
discovery, and socket setup path. The preferred recovery for ordinary gateway
closure is a socket-only reconnect, because live validation showed repeated
short-lived gateway sessions that still delivered useful status/map events. The
full reconnect remains the fallback when the current token/endpoint appears
unusable. The backoff and idle watchdog prevent short-lived gateway sessions
from becoming a tight cloud login loop.

## Consequences

The read-only adapter can recover from the observed gateway socket closure and
continue receiving pushed status events without requiring a manual instance
restart.

This does not yet prove command reliability. Commands still require separate
real-device verification, acknowledgement semantics, and capability gating.

If authentication repeatedly fails, the adapter will retry with the same bounded
backoff. A later decision may add error categories that stop retries for clearly
permanent credential failures.

## Alternatives Considered

Keep the current single-shot gateway connection and require manual restarts.
Rejected because live validation showed stale status after socket closure.

Reconnect only the TCP socket using the previous token and endpoint. Initially
rejected because token/endpoint lifetime is undocumented. Later live validation
accepted it as the first recovery step for gateway closes that already delivered
events, with full cloud reconnect retained as fallback.

Poll status over the cloud instead of reconnecting the gateway. Rejected for now
because pushed gateway events are already proven and polling semantics are not
yet documented for this adapter.

## Validation

Automated tests must cover the reconnect delay calculation. Adapter tests must
continue to pass without live credentials. Real-device validation should confirm
that status events resume after the gateway closes and reconnects.

CM4-Node-04 live validation on 2026-09-10 confirmed this behavior on the first M7
Pro test device: after an observed gateway socket close, the adapter scheduled a
five-second reconnect, re-established the gateway connection, and continued to
update read-only cleaning status values. No raw payloads, map data, serial
numbers, gateway endpoints, tokens, or private account data were recorded.
