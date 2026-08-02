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
