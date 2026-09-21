# ADR 0021: Guarded saved-zone cleaning

- Status: accepted for test-host validation
- Date: 2026-09-20
- Amended: 2026-09-21

## Context

The Proscenic app does not expose a conventional room-segmentation contract for
the verified M7 Pro. Users draw named zones, and the app obtains their complete
catalog through the asynchronous 21004 read path. Selectable zone IDs are sent
to the separate 30000 partial-cleaning command. Forbidden areas share the
catalog but must never be accepted as cleaning targets.

This feature mutates real robot state and depends on installation-specific map
and zone IDs. A stale selection must not be sent after the map or catalog has
changed.

## Decision

Expose the following objects:

- `capabilities.zoneCleaning`: true only for the verified M7 Pro while an
  authenticated command session and at least one current selectable zone are
  available;
- `commands.zones.available`: a read-only bounded JSON array containing only
  current selectable zone IDs and optional labels;
- `commands.zones.selectedIds`: a readable/writable JSON array of zone IDs;
- `commands.zones.start`: a write-only boolean button;
- `map.live.showZoneOverlays`: a readable/writable boolean VIS switch which
  controls both selectable-zone and forbidden-area overlays without removing
  the catalog or selection.

The selection state accepts a JSON numeric array and, for visualization
compatibility, a comma-separated numeric list. The adapter acknowledges a
canonical deduplicated JSON array. It rejects malformed, negative, duplicate,
or excessive selections.

Every accepted start trigger is serialized through the existing bounded
command queue. Before sending anything mutating, the adapter obtains a fresh
21004 catalog and requires:

1. at least one selected ID;
2. a valid active `mapId`;
3. an exact catalog/active-map match;
4. every selected ID to exist in the fresh catalog with `kind=zone`.

Only then may it send one request to
`/instructions/cmd30000/{serial}/{mapId}?username=...&part=true` with the JSON
array of selected IDs. The request is never automatically retried. Existing
command diagnostics report queueing, validation, REST acceptance, failure, and
the latency to a later `mode=sweep` status confirmation. REST acceptance alone
does not prove physical execution.

Changing `map.live.showZoneOverlays` re-renders the local image. When enabled,
the same-origin `map.live.viewerUrl` treats the projected bounds of current
selectable zones as click targets. A click toggles the corresponding ID through
the existing `commands.zones.selectedIds` contract. Unselected zones render
with a transparent white fill and stronger blue-gray boundary, while selected
zones use a transparent light-green fill. Forbidden areas remain visible but
are never click targets.

The viewer shows its zone-cleaning start action only when overlay selection is
enabled, `capabilities.zoneCleaning` is true, and at least one selected ID is
also present in the current `commands.zones.available` list. The compact action
writes only to `commands.zones.start`; it does not bypass the adapter's fresh 21004
validation or command queue. Turning the overlay switch off hides and disables
the click targets and start action. It does not change upstream zones, map
data, robot behavior, or silently clear a stored selection.

The selected IDs are task-scoped UI state. After an active cleaning task has
returned to the dock and the existing live-map lifecycle confirms a subsequent
`charge` or `fullcharge` state, the adapter acknowledges
`commands.zones.selectedIds` as `[]` and re-renders the map. The adapter also
recovers a pending, previously status-confirmed zone-cleaning selection from
the persisted command diagnostics when a reconnect or restart interrupted the
in-memory lifecycle. It compares the selection's ioBroker `lc` timestamp with
the last accepted zone-command execution so that a newer user selection is not
mistaken for the completed task. A pause, a transient charging report during
inferred cleaning activity, a failed command, or an unrelated initial docked
state does not clear the selection. This keeps completed zones from remaining
highlighted without weakening the protections against premature trail resets.

Zone labels are projected into a persistent transparent canvas at the polygon
centroid (falling back to the bounds center for older data). Drawing coordinates
are derived from the exact live-map pixels and the final fitted stage size. A
dedicated stage resize observer and a next-animation-frame render prevent the
canvas from retaining dimensions measured before VIS or the fullscreen view
has finished laying out the map. The layer shares all zoom and pan transforms
with the map image but is redrawn only when geometry, stage size, or zoom
changes, not for every map frame. Its bitmap resolution accounts for the device
pixel ratio and zoom while the visible text size remains stable. Labels use
text with a contrast stroke only; they do not introduce a separate background
or frame.

The viewer treats animated SVG as its preferred image source and PNG only as a
fallback. A lower-priority PNG update cannot replace a loaded or pending SVG.
This prevents the socket update sequence and polling fallback from making the
viewer oscillate between both representations of the same map frame.

## Consequences

VIS and scripts can select one or multiple saved zones without handling raw map
vertices. A forbidden area or stale ID cannot be submitted through the normal
adapter path. Zone names and IDs remain runtime installation data and are not
logged, committed, or used in public fixtures.

The object contract calls these entries zones rather than rooms. The interactive
viewer adds a friendly dynamic selector without changing or bypassing the
guarded command service.

## Alternatives Considered

Use the transient 20002 `area` list. Rejected because it is not the
authoritative saved-zone catalog.

Send the currently cached selection without refreshing 21004. Rejected because
the app can change or delete zones and a map change invalidates all IDs.

Create one permanent object channel per upstream zone ID. Deferred because the
dynamic lifecycle and migration burden are unnecessary for the first safe
command contract; the JSON selection supports both single- and multi-zone
cleaning.

## Validation

Automated tests cover selection parsing, forbidden/stale-zone rejection, exact
30000 request construction, object metadata, overlay hiding, selected and
unselected colors, viewer state wiring, confirmed task completion, and
projection.
The full adapter quality gate and test-host deployment are required. Actual
30000 execution on the real device remains a separate explicitly triggered
physical validation step; deployment alone must not start the robot.
