# Characters

This folder contains the simulation's fixed roster of ten characters. Profiles are
data only: they describe who a character is and how they tend to converse, but do
not contain sprites, placement, mood, relationships, memories, or any other
runtime state.

## Profile shape

Every JSON profile has the following groups:

- `identity`: stable identifying information.
- `portrait`: physical standing dimensions plus visual notes that guide sprite work.
- `personality`: a concise trait summary plus normalized behavioural tendencies
  (`0` = low, `1` = high).
- `interests`: recurring conversation material, with `expertise` identifying
  areas the character can speak about with confidence.
- `conversation`: voice and interaction preferences for prompt construction.
- `storyHooks`: tensions, goals, and invitations other characters can respond to.

Conversation participation is emergent rather than round-robin. The decision
model reads the complete profile together with mood, relationships, topic, and
recent conversation beats before choosing a speaker or a listening pause.
`conversation` may include free-form fields such as `style`, `initiative`,
`verbosity`, and `listeningStyle`. These describe tendencies rather than
hard probabilities: a shy character may mostly listen, while an outgoing
character may speak for several consecutive beats when the situation supports
it. Global simulation tuning is only a fallback when profiles provide little
evidence.

`id` values are stable, kebab-case identifiers. New engine state should refer to
them rather than names. The roster intentionally does not prescribe friendships
or rivalries; those are emergent runtime relationships.

## Standing dimensions and pixel scale

`portrait.dimensionsCm` records the character's standing `width` and `height` in
centimetres. Width is the widest natural full-body silhouette, including normal
clothing but excluding handheld props that extend beyond the body. Height is the
vertical distance from the shared foot baseline to the topmost body pixel.

Felix Adebayo is the scale reference. His 188 cm height occupies 96 pixels in
`neutral-idle-minimal-v3.png`, giving this production scale:

```text
pixelsPerCm = 96 / 188 = 0.510638
centimetresPerPixel = 188 / 96 = 1.958333
pixelWidth = round(widthCm * pixelsPerCm)
pixelHeight = round(heightCm * pixelsPerCm)
```

All standing characters fit a logical bounding box of **70 cm × 200 cm**, or
**36 px × 102 px** at the production scale. Place that box inside a 48 px ×
128 px transparent sprite canvas. Centre the character horizontally in the box
and align the lowest opaque foot pixel to the common baseline at `y = 111`,
leaving 16 pixels below it. Accessories may remain inside the 48 px canvas, but
must not change the physical dimensions or baseline. Use nearest-neighbour
resampling only; never anti-alias production sprites.

The combined lineup at `assets/characters/standing-lineup.png` is a visual
concept master rather than a sprite sheet to slice directly. Individual
production assets should be redrawn or reduced to the calculated dimensions
above so every pose and character shares one stable world scale.

## Pose contract

All production poses use the same **48 x 128 px transparent logical canvas**.
Scene code applies its display scale only while compositing; source sprites remain
logical-sized and are never resaved at scene scale.

- Standing left, right, and front poses use the foot baseline at `(24, 111)`.
- Sitting poses declare a direction-specific pelvis contact point measured in the
  logical canvas. Felix uses `(34, 74)` facing left and the exact mirrored point
  `(13, 74)` facing right.
- Sitting-sleeping poses use the same direction-specific contact points. Sleep is a sitting state, not a
  separate furniture interaction.
- Right-facing side poses should be exact nearest-neighbour horizontal mirrors of
  approved left-facing finals unless a directional prop requires unique art.
- Sprite PNGs must be RGBA with hard alpha. Never embed a floor, contact shadow,
  furniture, or scene lighting.

Canonical paths are `{pose}/{direction}/{state}.png`. Supported poses are
`standing`, `sitting`, and `sitting-sleeping`; directions are `left`, `right`, and,
for standing, `front`.

Felix Adebayo is the first complete implementation. His seven canonical assets
and anchors are enumerated in `assets/characters/felix-adebayo/manifest.json`.
