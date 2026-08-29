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
characters. Name, personality, and background may be adapted before entering
the world; age remains fixed to match each sprite. Scene and cast are then fixed until reload, while the four compact
world-shaping controls remain live.

“What should happen?” can direct the world toward one shared preset or a custom
development. “Let faith choose” adds no direction. A concrete selection remains
active across steps until the observer chooses something else; after the event
happens, the world progresses its consequences instead of repeating it.

Play starts continuous simulation and Stop ends it after the current request.
The engine readability pacer keeps visible prose on screen at a 250-WPM reading
rate, with request time counting toward the delay.

The app reuses the shared engine state, rules, provider, random placement,
renderer, mood hover, and pacing modules. Its own TypeScript is limited to the
product-specific setup, presentation, and playback flow.
