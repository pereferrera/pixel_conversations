# Pixel Conversations app

This is the observer-facing experience. It deliberately hides model selection,
provider requests, raw state, and other developer controls exposed by the
separate debugger.

Run it from the repository root:

```bash
npm run app
```

Then open <http://localhost:4173/>. The server reads `OPENAI_API_KEY` from the
shell or `debug/.env`; the key is never sent to browser code.

On every reload, the observer chooses a scene and invites one or more available
characters. Each character's own selection card doubles as its editor: an
icon-only toggle next to an invited character reveals its name, personality,
and background inline, with a single Generate button that randomizes
personality and background together. Name and age stay put; age is fixed to
match each sprite, and name changes are typed manually rather than
regenerated. Scene and cast are then fixed until reload, while the four
compact world-shaping controls remain live.

“What should happen?” can direct the world toward one shared preset or a custom
development. “Let faith choose” adds no direction. A concrete selection remains
active across steps until the observer chooses something else; after the event
happens, the world progresses its consequences instead of repeating it.

The simulation starts playing automatically once the world is entered. Stop
pauses it after the current request, and Play resumes it. The engine
readability pacer keeps visible prose on screen at a 250-WPM reading rate,
with request time counting toward the delay.

A small in-scene player sits over the world image with a mute toggle, a
track picker, and a volume slider. It starts on a random loop from
`audio/tracks.json` and keeps playing across steps; switching tracks in the
picker changes the loop immediately. Volume and mute preferences persist
across reloads.

The app reuses the shared engine state, rules, provider, random placement,
renderer, mood hover, and pacing modules. Its own TypeScript is limited to the
product-specific setup, presentation, and playback flow.
