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
- `map.live.currentAreaCount`;
- `map.live.cachedAreaCount`;
- `map.live.renderedForbiddenAreaCount`;
- `map.live.renderedRoomAreaCount`;
- `map.live.hasCachedStaticOverlays`;
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

The adapter keeps the last valid coordinate metadata for static overlays and
the charging station in memory per `mapId`. Observed M7 Pro captures show that
20002 `area` frames are partial and transient: one frame can contain the
configured no-go area plus user-created room zones, while later frames for the
same map can contain only the no-go area. The adapter therefore deduplicates
areas and merges them into the per-map cache instead of letting the last frame
win. A `mapId` change drops the cached coordinate metadata.

Area classification is intentionally heuristic during local development.
Duplicate area entries in a multi-area frame and single-area frames are treated
as no-go/forbidden overlays. Other deduplicated entries from a multi-area frame
are treated as room-zone overlays and rendered in a distinct translucent blue.
The observed `forbidType` field is not sufficient for classification because
the same value appeared on both the confirmed no-go area and likely room zones.
Different app accounts can expose different permissions and metadata; the main
adapter account is authoritative for this development adapter, while screenshots
from a shared app account are treated as visual references only.

The in-memory pose trail is scoped to the active map path. When a later 20002
event reports a different `pathId`, the adapter clears its own collected pose
trail before rendering the new path. Any old route still visible after that
comes from the robot-provided 20002 occupancy/map snapshot or from the app, not
from the adapter's 20001 pose overlay. The renderer skips duplicate or tiny
pose movements and implausibly long jumps between two gateway samples. For
moderate gateway gaps it first tries the direct segment. If that direct segment
would cross a wall or obstacle pixel in the decoded occupancy grid, the
renderer searches for a short local collision-free route and draws that
instead. The path brush itself is clipped to traversable map pixels so
interpolation cannot paint the robot through walls. If no bounded local route
is found, the segment is skipped.

The diagnostic states explain why the current image changed and how much of
the in-memory pose trail was rendered:

- `rawPoseCount` is the number of in-memory 20001 poses available for the
  current render.
- `poseCount` is the number of those poses that could be projected into the
  current 20002 map coordinate space.
- `pathLineSegments` is the number of accepted pose-to-pose line segments.
- `skippedPathSegments` is the number of rejected duplicate, too-small, or
  implausibly large pose jumps.
- `currentAreaCount` is the raw `area` count in the latest 20002 frame.
- `cachedAreaCount` is the deduplicated per-map overlay count kept in memory.
- `renderedForbiddenAreaCount` is the number of no-go overlays drawn into the
  latest image.
- `renderedRoomAreaCount` is the number of room-zone overlays drawn into the
  latest image.
- `hasCachedStaticOverlays` indicates whether the latest render used cached
  static overlay metadata.
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
