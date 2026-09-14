# ADR 0016: Experimental live map object for local visual debugging

- Status: accepted for local development
- Date: 2026-09-13

## Context

Private M7 Pro captures proved that `infoType` 20002 contains a self-contained
LZ4-compressed occupancy grid after base64 normalization. The app-conform
orientation for the observed device is a vertical flip of the decoded grid.

Further map work needs fast visual feedback in ioBroker VIS while the real
robot is cleaning. The rendered map is still private home-layout data, even
when it is not a raw payload.

## Decision

Expose an explicit experimental live-map image under:

- `map.live.image`;
- `map.live.updated`;
- `map.live.orientation`;
- `map.live.poseCount`;
- `map.live.rawPoseCount`;
- `map.live.pathLineSegments`;
- `map.live.skippedPathSegments`;
- `map.live.renderReason`;
- `map.live.lastPathId`;
- `map.live.pathResetCount`;
- `map.live.lastPoseUpdated`;
- `map.live.decompressedBytes`.

`map.live.image` contains a bounded RGB PNG data URL rendered from the latest
20002 occupancy grid. The adapter uses the currently verified `flip-y`
orientation, an app-oriented color palette, and overlays available coordinate
metadata plus in-memory robot poses from 20001 events when present. For the
observed M7 Pro, occupancy value `255` is rendered as the medium-blue unknown
background, `127` as the white room area, and `0` as the darker blue map line.
The adapter-owned pose trail uses a dedicated light-green overlay color instead
of reusing the background, room, or wall colors. The pose trail is rendered
wider than one pixel for VIS readability.

The adapter keeps the last valid coordinate metadata for no-go areas and the
charging station in memory per `mapId`. If a later 20002 map frame for the same
map omits that metadata, rendering carries the cached metadata forward so
VIS does not lose static overlays during a cleaning run. A `mapId` change drops
the cached coordinate metadata.

The in-memory pose trail is scoped to the active map path. When a later 20002
event reports a different `pathId`, the adapter clears its own collected pose
trail before rendering the new path. Any old route still visible after that
comes from the robot-provided 20002 occupancy/map snapshot or from the app, not
from the adapter's 20001 pose overlay. The renderer skips duplicate or tiny
pose movements and implausibly long jumps between two gateway samples instead
of drawing misleading straight lines across the map.

The diagnostic states explain why the current image changed and how much of
the in-memory pose trail was rendered:

- `rawPoseCount` is the number of in-memory 20001 poses available for the
  current render.
- `poseCount` is the number of those poses that could be projected into the
  current 20002 map coordinate space.
- `pathLineSegments` is the number of accepted pose-to-pose line segments.
- `skippedPathSegments` is the number of rejected duplicate, too-small, or
  implausibly large pose jumps.
- `renderReason` is `map` for a new 20002 map snapshot and `pose` for a 20001
  pose-triggered refresh.
- `lastPathId` is the latest observed map path identifier.
- `pathResetCount` counts adapter-side pose trail resets caused by `pathId`
  changes.
- `lastPoseUpdated` records the latest accepted 20001 pose event timestamp.

The adapter must not log or commit raw 20002 payloads, decompressed map bytes,
serials, coordinates, captures, generated private map files, or VIS screenshots.
The latest raw map and pose list may exist only in adapter memory for rendering.

This decision is accepted for local development and visual debugging. It is not
a final publication contract; before a public release, the project must revisit
whether live maps need an Admin opt-in, retention controls, file serving instead
of state data URLs, localization, color themes, and a migration note.

## Consequences

VIS can bind directly to `proscenic.<instance>.map.live.image` and show the
current map without any extra file server.

The object tree now deliberately contains private owner-local map imagery. This
is acceptable for the shared development test installation but must be treated
as private user data in support cases and publication documentation.

## Validation

Unit tests must cover the renderer with synthetic LZ4 data, object definitions,
and projection of the live-map states. Full adapter checks are required because
this touches public objects, protocol-derived map handling, and runtime
projection.
