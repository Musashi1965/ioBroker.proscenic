# ADR 0020: Animated live map and task-scoped trail lifecycle

- Status: accepted for local development
- Date: 2026-09-17

## Context

The first live-map implementation published a newly rendered PNG whenever a
20001 gateway pose arrived. This makes the robot marker jump between sparse
cloud positions. It also tied trail cleanup too closely to raw mode strings.
Real-device observation shows that `charge` or `fullcharge` can occur
transiently while the robot is still cleaning. Treating every such event as a
completed task allows a later `sweep` event or `pathId` change to erase the
trail in the middle of one cleaning task.

VIS consumers need a smooth marker without increasing gateway traffic or
writing fabricated intermediate coordinates into ioBroker. Consumers that do
not render SVG still need a static image.

## Decision

The adapter publishes three bounded image states:

- `map.live.image` is the primary animated SVG data URI;
- `map.live.svgDataUri` is an explicit alias for that SVG;
- `map.live.pngDataUri` is a static PNG fallback containing the marker at the
  latest confirmed pose.
- `map.live.viewerUrl` is the stable same-origin path
  `/proscenic/map-viewer/?instance=<n>` for an iframe-capable live viewer.

`map.live.format` reports `svg`. The SVG embeds a rasterized base map containing
the accumulated trail and overlays the current robot marker. On a pose-triggered
render, SVG `animateMotion` moves the marker over the newest accepted,
wall-aware path segment. Map-triggered renders place the marker statically so a
map refresh cannot replay an old movement. Animation happens entirely in the
consumer and creates no additional cloud requests or ioBroker state writes.

Trail lifecycle is modeled independently from individual `pathId` values. A
task becomes docked only when:

- a charging status arrives while no recent cleaning activity is inferred; or
- charging follows an observed `backcharge` return-to-dock state.

A transient `charge` or `fullcharge` during inferred active cleaning does not
mark the task complete. Once a `sweep` has opened an explicit cleaning task,
charging without a preceding `backcharge` also cannot close it merely because
the short activity-inference window expired, for example during a pause. The
accumulated trail is cleared only when a new `sweep` begins after a confirmed
docked state. A `pathId` change never erases a trail; this prevents room
transitions and delayed map frames from truncating the active task.

Raw poses remain adapter-memory-only. The adapter does not add public raw
coordinate states, persist maps to disk, or increase protocol polling.

The packaged viewer is served by the ioBroker web adapter from `www/map-viewer`.
It reads only the current adapter instance's bounded SVG/PNG states through the
authenticated same-origin ioBroker socket, falls back to the web adapter's
read-only state endpoint, validates the accepted image data-URI formats, and
retains its iframe and viewport across updates. New images are decoded before
they replace the visible image, so updates do not intentionally fade two full
map frames through one another. The viewer has no redundant internal heading,
uses the existing writable `map.live.canvasBackgroundColor` for the complete
viewer surface, and centers the contained map with a fixed margin. It supports
bounded zoom and pan; wheel zoom requires Ctrl or Command so ordinary dashboard
scrolling cannot accidentally move the map. Reset restores the centered fit.

## Consequences

Existing VIS bindings to `map.live.image` receive SVG instead of PNG and gain
smooth marker movement when the image widget supports SVG data URIs. Consumers
that require PNG must bind to `map.live.pngDataUri`.

Iframe-capable visualizations can bind to `map.live.viewerUrl`. Because the URL
does not change for each map frame, the iframe remains connected while the
viewer refreshes only its internal image. The ioBroker web adapter must be
installed and reachable on the same origin as the visualization.

The static map and full task trail no longer need to be redrawn by the browser
during animation. The SVG data URI is somewhat larger than the PNG because it
contains the raster base plus vector markup, so both outputs remain subject to
the existing size bound.

## Alternatives Considered

- Publishing intermediate positions from adapter timers was rejected because
  it would create synthetic state traffic and couple animation frequency to
  ioBroker writes.
- A separate adapter-owned HTTP server was rejected because it would add a port,
  authentication, and lifecycle boundary. Static web-adapter assets provide the
  required stable viewer URL without another server.
- Resetting on every `pathId` or raw charging status was rejected because both
  have been observed inside a still-active cleaning task.

## Validation

Unit tests cover SVG and PNG outputs, animated and static marker modes, public
object and viewer-URL projection, packaged viewer assets, and task-state
transitions including transient charging and confirmed return-to-dock
sequences. The full adapter quality gate is required.
