# Rendering

Browser-side rendering business logic lives here, independently of the simulation engine and any app UI.

`renderWorldToPng()` accepts a world snapshot, character profiles, and URLs for its scene definition and character manifests. It loads the declared assets, depth-sorts scene elements and characters, places sprites using scene/manifest anchors, adds the latest active conversation line and speaker name as a speech bubble, and returns a PNG `Blob` with non-fatal warnings.

Callers are responsible only for storing the returned blob or displaying it with an object URL. They should not duplicate placement, asset-selection, canvas, or dialogue-rendering rules.
