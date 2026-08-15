# World Rendering

`renderWorldToPng` returns the rendered PNG, warnings, and
`characterMoodHitRegions`. Each region uses source-canvas coordinates and
contains the character id, display name, render depth, bounds, and mood.

Awake characters always render their posture-and-direction `neutral` sprite.
Non-neutral emotional states render separately using the shared 16 x 16 assets
in `RenderingConfig.moodAssets`, centered above the character's topmost opaque
sprite row. Sleeping characters retain their dedicated side-facing sprites and
do not display a mood icon.

Use `attachCharacterMoodHover(image, result.characterMoodHitRegions)` to add a
responsive hover tooltip to an `<img>` displaying that PNG. The binding maps
CSS-scaled pointer coordinates back to the source canvas, selects the topmost
overlapping character by render depth, and displays emotional state, valence,
energy, and social need. Call `destroy()` before replacing the image or removing
it from the page.
