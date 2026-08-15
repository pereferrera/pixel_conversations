# Scenes

Scenes are fixed-scale, layered 2D spaces. They use a cheated Zelda-style
top-down 3/4 view to suggest depth, but character sprites are never scaled
according to their vertical position.

## Production canvas

Every scene is **1152 x 648 px** (16:9). This is 1.5 times the first-iteration
768 x 432 canvas and follows the character production
scale documented in `characters/README.md`. Logical character assets remain at 48 x
128 px, but this scene displays them at **1.875x**, or **90 x 240 px**; the maximum
physical silhouette becomes approximately 68 x 191 px. This scale is based on the
cafe door-to-person proportion.

- Five standing characters can be distributed at roughly 180 px intervals,
  leaving clear visual gaps and room for props.
- Ten standing characters can be distributed at roughly 90 px intervals. At
  that density silhouettes remain legible, but the room intentionally looks busy.
- Characters retain the same pixel dimensions everywhere in a scene.
- Use integer coordinates and nearest-neighbour resampling only.

### Background pixel density

The background is deliberately less detailed than the original generated source.
It is reduced onto a **576 x 324 logical pixel grid** and enlarged exactly 2x with
nearest-neighbour sampling to reach 1152 x 648. This removes high-resolution
micro-texture and produces broad, stable pixel clusters that sit behind the much
smaller character silhouettes without competing with them. Characters use a **1.875x scene display scale** and separate elements use
**1.5x**, both with nearest-neighbour sampling. The larger character multiplier
corrects their apparent height relative to architectural features such as doors.
The background alone uses its separate 2x logical-grid treatment.

The camera model is a **classic Zelda-style fake top-down 3/4 perspective**. It
is intentionally cheated 2D, not axonometric, isometric, or true perspective.
Furniture remains upright and front-facing: its primary edges are perfectly
horizontal and vertical relative to the screen. Never rotate, skew, tilt, shear,
or introduce diagonal main edges. Suggest depth only with narrow visible top and
side strips, small stepped positional offsets, shading, and foreshortening.

## Coordinates and depth

The origin is the upper-left corner. A standing character's world position is its
foot baseline, not the top-left of its displayed 90 x 240 canvas. The logical
48 x 128 sprite is scaled 1.875x with nearest-neighbour sampling. Its displayed
baseline is local `y = 208`, so draw it at
`(baseline.x - 45, baseline.y - 208)`.

Instances are drawn by ascending `depthBaselineY`; ties are resolved by array
order. This simple painter's algorithm provides depth without changing scale.
Background pixels are always drawn first. A future object that needs a character
to pass behind and in front of it should be exported as separate rear and front
layers sharing one anchor.

## Metadata contract

Each scene has a `scene.json` with:

- `canvas`: production width, height, coordinate origin, and fixed scale.
- `standingArea`: one or more polygons containing legal character baselines.
- `elementPlacementAreas`: named polygons containing legal element anchors and
  the element types allowed there.
- `elementTypes`: canvas dimensions, bottom-centre placement anchor, conservative
  floor footprint, depth baseline, and seat anchors for each separate graphic.
- `positions`: named runtime places the simulation may use. Each declares a
  semantic label, standing-or-seat kind, allowed postures and directions, plus
  a renderer binding. Standing bindings use a baseline; seat bindings use the
  stable `(elementInstanceId, seatId)` pair described below.
- `conversationPairs`: the physical position pairs close enough for a
  two-person conversation, with the required left/right facing at each position.
- `example.instances`: the exact elements and characters used in `example.png`.

Polygons use inclusive integer pixel coordinates and must list points clockwise.
An instance is legal only when its anchor lies in an allowed polygon and its
translated `footprint` does not cross the scene canvas. Collision checks should
use footprints; visual overlap is resolved with `depthBaselineY`.

### Seat-slot binding

Characters and furniture declare separate contact anchors; never align canvas
centres or opaque bounding boxes. A sitting character declares one logical pelvis
contact anchor per direction. Every furniture `seats` entry declares an
element-local `contactAnchor`, stable `id`, zero-based `seatIndex`, allowed occupant
directions, and a conservative `clearance` rectangle. `seatCapacity` must equal the
length of `seats`.

Given an element instance:

```text
elementTopLeft = elementAnchor - elementPlacementAnchor
seatWorld = elementTopLeft + seat.contactAnchor
characterContactDisplayed = round(characterContactLogical * characterDisplayScale)
characterTopLeft = seatWorld - characterContactDisplayed
```

Round each displayed coordinate independently to the nearest integer. Bind runtime
occupancy by `(elementInstanceId, seatId)`, not by element type or array position.
Draw the element, then the bound character, at adjacent depth values.

Prompt builders should expose only position ids, labels, kinds, allowed
postures/directions, current occupancy, and conversation pairs. Pixel baselines
and seat renderer bindings are renderer concerns and should not be sent to the
decision model.

Every production scene must expose at least 20 runtime positions, including
both standing and seated choices. Distribute standing baselines across multiple
depth rows and connect nearby positions through `conversationPairs`; preserve
stable ids when expanding an existing scene.

### Conversation placement

A conversation can start only when its two participants occupy one declared
`conversationPairs` entry and each uses the facing listed alongside that
position. This makes them physically close and visually oriented toward one
another. Movement actions may establish that arrangement earlier in the same
decision, but must precede `startConversation`. Participants cannot move again
until `endConversation`.

The convention is capacity-independent. One-, two-, and three-seat elements simply
provide one, two, or three ordered slots from screen-left to screen-right. Each
slot must be positioned at the visual centre of its cushion and have a clearance
rectangle that does not overlap another slot.s clearance. Three-seat furniture
therefore requires no renderer special case.

## Community cafe example

`community-cafe` is the first scene implementation:

- `assets/scenes/community-cafe/background.png`: 1152 x 648 px background,
  rendered from a 576 x 324 logical grid at nearest-neighbour 2x.
- `assets/scenes/community-cafe/elements/wood-chair.png`: 96 x 96 px RGBA,
  one seat.
- `assets/scenes/community-cafe/elements/teal-bench.png`: 192 x 96 px RGBA,
  two seats.
- `assets/scenes/community-cafe/example.png`: flattened 1152 x 648 px preview.
- `scenes/community-cafe/scene.json`: placement and example metadata.

The flattened preview contains two chair instances, one bench, and three standing
characters. Characters are displayed at 1.875x and furniture at 1.5x. Their positions are deliberately irregular but deterministic and are
recorded in the JSON. Because the repository currently has only one individual
production character sprite, the preview uses three temporary cutouts from
`assets/characters/standing-lineup.png`. The lineup is a concept master, so those
cutouts exist only inside the flattened preview and must not be used as production
character assets.

The generated artwork uses a warm community-cafe palette and keeps the movable
floor clear. Seating uses dark walnut, deep desaturated teal, subdued amber bounce,
and an upper-left light direction so it remains slightly darker than the room's
architectural surfaces. The background and furniture were generated with the
built-in image-generation workflow; furniture was generated on a flat chroma key,
converted to alpha, and reduced to the dimensions above.

## Museum reading room example

`museum-reading-room` independently exercises the same contract:

- `assets/scenes/museum-reading-room/background.png`: 1152 x 648 background.
- `elements/burgundy-reading-chair.png`: 96 x 96 RGBA, one seat.
- `elements/navy-reading-bench.png`: 192 x 96 RGBA, two seats.
- `assets/scenes/museum-reading-room/example.png`: flattened five-character
  preview containing Felix final sitting-left sprite bound to a chair seat anchor and
  four preview-only lineup cutouts.
- `scenes/museum-reading-room/scene.json`: complete placement metadata.

## Repeatable generation checklist

1. Generate a furniture-free 16:9 background with an open placement floor and
   human-scale architecture. Reduce it to 576 x 324, then enlarge exactly 2x.
2. Generate each sitting element separately on a flat chroma-key background.
   Keep all main edges screen-horizontal or screen-vertical and fake depth only
   with stepped offsets, narrow top/side strips, shading, and foreshortening.
3. Remove the chroma key, reduce with nearest-neighbour filtering, hard-threshold
   alpha, and export on the standard 96 x 96 or 192 x 96 element canvas.
4. Record each element bottom-centre placement anchor, footprint, depth baseline,
   ordered seat slots, capacity, clearances, allowed placement polygons, and source
   asset path.
5. Place logical 48 x 128 character sprites at 1.875x without resaving them. Sort
   foreground instances by `depthBaselineY` and flatten an example.
6. Validate PNG dimensions and alpha, validate JSON syntax, and ensure every
   referenced asset exists. Identify preview-only lineup cutouts explicitly; they
   must never become canonical character assets.

### Known seating limitation

Current sitting elements are single RGBA sprites. Seat anchors are production-ready,
but a single layer cannot place a character behind armrests while keeping the legs
in front of the seat rail. Elements that require that occlusion must later export
matching `rear` and `frontOccluder` layers around the same placement anchor. Until
then, render the whole element behind the seated character, as the museum example
does. This is sufficient for open-front chairs but not the final solution for deep
armchairs or high front rails.
