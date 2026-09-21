# ADR 0016: Experimental live map object for local visual debugging

- Status: accepted for local development
- Date: 2026-09-13
- Amended: 2026-09-21

The image format and pose-trail lifecycle portions of this decision are amended
by ADR 0020. The remaining privacy, metadata-cache, color, and diagnostics
decisions stay in force.

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
- `map.live.svgDataUri`;
- `map.live.pngDataUri`;
- `map.live.format`;
- `map.live.viewerUrl`;
- `map.live.areas`;
- `map.live.areaSource`;
- `map.live.zoneCatalogUpdated`;
- `map.live.zoneCatalogLastReadResult`;
- `map.live.zoneCatalogLastError`;
- `map.live.updated`;
- `map.live.orientation`;
- `map.live.poseCount`;
- `map.live.rawPoseCount`;
- `map.live.pathLineSegments`;
- `map.live.skippedPathSegments`;
- `map.live.currentAreaCount`;
- `map.live.cachedAreaCount`;
- `map.live.renderedForbiddenAreaCount`;
- `map.live.renderedZoneAreaCount`;
- `map.live.renderedRoomAreaCount`;
- `map.live.hasCachedStaticOverlays`;
- `map.live.canvasBackgroundColor`;
- `map.live.mapBackgroundColor`;
- `map.live.backgroundColor`;
- `map.live.showZoneOverlays`;
- `map.live.renderReason`;
- `map.live.lastPathId`;
- `map.live.pathResetCount`;
- `map.live.lastPoseUpdated`;
- `map.live.decompressedBytes`.

`map.live.image` contains the bounded primary image representation rendered
from the latest 20002 occupancy grid. ADR 0020 changes that primary format from
PNG to animated SVG and keeps a static RGB PNG fallback in
`map.live.pngDataUri`. The adapter uses the currently verified `flip-y`
orientation, an app-oriented color palette, and overlays available coordinate
metadata plus in-memory robot poses from 20001 events when present. For the
observed M7 Pro, occupancy value `255` is rendered as the light/medium-blue map
area by default, `127` as the white canvas/background area, and `0` as the
darker blue map line. Local VIS color tuning is exposed through two writable
`#RRGGBB` states:

- `map.live.canvasBackgroundColor` controls the canvas/background pixels that
  are white by default and correspond to occupancy value `127`.
- `map.live.mapBackgroundColor` controls the light/medium-blue map-area pixels
  that correspond to occupancy value `255`.

The legacy writable `map.live.backgroundColor` state remains as a compatibility
alias for `map.live.mapBackgroundColor`. The adapter acknowledges normalized
valid writes with `ack=true` and restores the previous value for invalid
writes. The adapter-owned pose trail uses a dedicated light-green overlay color
instead of reusing the background, room, or wall colors. The pose trail is
rendered wider than one pixel for VIS readability.

`map.live.showZoneOverlays` controls whether saved selectable zones and
forbidden-area polygons are drawn into the local image. The default is `true`.
Unselected selectable zones use a transparent white fill and a stronger
blue-gray boundary; zone IDs currently present in
`commands.zones.selectedIds` use a transparent light-green fill.
When the authoritative 21004 catalog supplies a non-empty `name` or `tag`, the
animated SVG renders that bounded, escaped label at the center of the
selectable zone. Labels are omitted together with the polygons when zone
overlays are disabled. The PNG remains a static compatibility fallback and
does not contain vector text.
To avoid label flicker when pose events replace the SVG data URI, the packaged
viewer removes the marked SVG label elements from its frequently changing
image and renders the same bounded labels as a separate map-stage overlay.
That overlay shares the map transform and survives image swaps, so it remains
aligned during fit, pan, and zoom without being repainted for every robot pose.
Each label anchor is expressed as a percentage of the immutable source-image
dimensions. Responsive stage resizing therefore scales the map, zone overlays,
and label anchors through the same browser layout instead of independently
converting label positions through transient viewport pixel dimensions. The
viewer also assigns the label layer the exact fitted map-stage width and height
after every resize instead of relying only on absolute-positioning shorthand;
this keeps the invariant intact in embedded VIS browser runtimes.
Turning the switch off leaves `map.live.areas`, the 21004 catalog, and the
stored zone-cleaning selection untouched. In the interactive viewer it also
disables click selection and hides the contextual start action. ADR 0021
defines its writable and interaction semantics.

`map.live.viewerUrl` contains the revisioned same-origin web-adapter path for
the interactive viewer defined by ADR 0020. Its implementation-revision query
invalidates stale VIS/web-adapter caches after viewer changes but remains stable
across live map frames. It is a URL only and contains neither map data nor
installation-specific network coordinates.

`map.live.areas` contains a bounded JSON summary from the authoritative 21004
saved-zone catalog. Each entry may include the stable area key, kind
(`forbidden` or `zone`), upstream area ID, app-provided label, and projected
pixel bounds. It does not contain raw vertices, the serial number, credentials,
or gateway data. `active=forbid` identifies forbidden areas; other catalog
entries are selectable multi-zone-cleaning zones. They are not described as
rooms because the Proscenic app models user-drawn zones rather than a room
segmentation layer.

The adapter requests the catalog with the verified 21004 instruction path and
receives its actual content asynchronously as a gateway `infoType=21004`
event. The `mapId` must match the active 20002 map. A valid response replaces
the complete previous catalog; this is deliberately not a merge, so deleted or
changed zones cannot survive in adapter memory. A `mapId` change immediately
drops the old catalog and requests a fresh one.

`infoType=20002` remains authoritative only for the occupancy grid, coordinate
system, map/path IDs, and charging position. Its transient `area` member is not
used for `map.live.areas` or overlay classification. This removes the former
duplicate-count and single-entry heuristics, which were proven unable to
distinguish selectable zones from forbidden areas.

The in-memory pose trail is scoped to the active cleaning task, not to every
observed `pathId`. A `pathId` can change when the robot moves from one room or
partial path to the next while the same cleaning task is still running. The
adapter therefore keeps its collected 20001 pose trail across ordinary `pathId`
changes and only resets it when a new cleaning task starts after a confirmed
docked/charging state. Any old route still visible after such a task reset
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

- `areas` is the current 21004 saved-zone summary used for the live-map render.
- `areaSource` is fixed to `21004`; the catalog timestamp, read result, and
  redacted error states expose acquisition health.
- `rawPoseCount` is the number of in-memory 20001 poses available for the
  current render.
- `poseCount` is the number of those poses that could be projected into the
  current 20002 map coordinate space.
- `pathLineSegments` is the number of accepted pose-to-pose line segments.
- `skippedPathSegments` is the number of rejected duplicate, too-small, or
  implausibly large pose jumps.
- `currentAreaCount` and `cachedAreaCount` are the current validated 21004
  catalog count.
- `renderedForbiddenAreaCount` is the number of no-go overlays drawn into the
  latest image.
- `renderedZoneAreaCount` is the number of selectable zone overlays drawn into
  the latest image.
- `renderedRoomAreaCount` remains a deprecated compatibility alias for
  `renderedZoneAreaCount`; consumers should migrate to the accurate name.
- `hasCachedStaticOverlays` indicates whether the latest render used cached
  static overlay metadata.
- `renderReason` is `map` for a new 20002 map snapshot, `pose` for a 20001
  pose-triggered refresh, and `zones` for a 21004 catalog refresh.
- `lastPathId` is the latest observed map path identifier.
- `pathResetCount` counts adapter-side pose trail resets caused by a new
  cleaning task after a confirmed docked/charging state.
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
