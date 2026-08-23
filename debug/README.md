# State machine debugger

This local browser utility sends the current JSON world to a `Provider`.
It renders the current world as a PNG above the diagnostics and keeps the full
provider boundary visible: the exact request and prompts, the
untouched response body, the parsed actions, and the resulting world state.
Parsed OpenAI changes must use the state API's canonical `type` discriminator.
Response status, OpenAI request id, and processing time appear beside the raw
response when the API supplies them. Decisions are validated and applied as one
unit through the engine's strict `applyDecision` path. If any action is invalid,
the complete decision is rejected and the validation errors appear in status.

Conversation actions are applied in returned order, so a decision may
`startConversation` and then `say` the exact opening words. Later decisions
use `say` to continue it and `endConversation` to mark it `closing` after
releasing its participants. Its final speech remains visible until the debug
app removes the closing conversation at the start of the next step. An `addEvent`
that attempts to narrate dialogue or conversation lifecycle is logged and
skipped.

One non-dialogue world event may be active per frame. The renderer displays it
as a distinct narration panel, and the debug app expires it before requesting
the next simulation step.

Active conversations use an ordered `beats` array: `say` beats contain exact
dialogue and `pause` beats represent listening silence. Memories use the
`{ summary, importance }` form.

## Run it

From the repository root:

```bash
npm install
npm run debug
```

Before starting the server, copy `debug/.env.example` to `debug/.env` and add
your key:

```dotenv
OPENAI_API_KEY="your_api_key_here"
```

The debug server loads this file on startup. A key already exported in the
shell takes precedence over the file. `debug/.env` is covered by the repository's
`.env` ignore rule and must not be committed or exposed to browser code.

Open <http://localhost:4173/debug/>. Stop the server with Ctrl+C. The build is
written to `.debug-build/`; it can be removed at any time.

Choose any of the six bundled scenes, enable any combination of the ten production
characters, and edit their personality or background text before simulating.
Changing a scene or participant selection starts a fresh simulation with random
placements; text edits are applied to the next provider request.

Optionally change the model and click **Simulate next step**. Check **Auto** to
start immediately and request each next step after the current step has been
applied and rendered. Auto mode keeps each frame's visible speech and event text
on screen long enough to read at a fixed 250 words per minute. Provider latency
counts toward that reading time; when a response arrives early, its application
waits only for the unread remainder. Frames without visible prose add no delay.
Manual simulation remains explicitly user-paced. Uncheck Auto to stop after the
in-flight step; errors stop auto mode as well. The browser sends the provider request to the same-origin
local endpoint at `/api/responses`.
The local server adds `OPENAI_API_KEY` and forwards it to OpenAI, avoiding CORS
and keeping the secret out of browser code. The server binds to loopback only
and is intended for local debugging, not deployment.

If `OPENAI_API_KEY` is absent from both the shell and `debug/.env`, the endpoint
returns a configuration error.

## Debug config format

The bundled `example-world.json` loads automatically. Use **Debug config JSON**
to load another local file. A file contains:

- `scenes`: selectable scene ids, labels, and definition URLs.
- `characters`: profile and sprite-manifest URLs for selectable characters.
- `moodAssets`: shared emotional-state icon URLs.

The bundled example offers all six fixed scenes and the four characters that
currently have production assets. Each listed character has standing, sitting,
and seated-sleeping sprite manifests. On each page reload, selected characters are
initialized at distinct random scene positions. Posture and facing are selected only
from each position's declared affordances. This uses the reusable engine helper
`placeCharactersRandomly`.

Hover a rendered character to inspect their concrete emotional state plus
valence, energy, and social need. The debugger uses the renderer's reusable
`attachCharacterMoodHover` binding rather than debugger-specific hit testing.

The world-tendency slider passes an engine `SimulationTuning.worldTendency`
value into each provider request. Use `-1` to stress conflict and adverse
developments, `0` for balanced outcomes, and `+1` for consistently peaceful and
fortunate developments. The exact prompt is visible in the provider-request
panel.

Three additional `-1..1` sliders expose the engine's dialogue and pacing priors.
`pomposity` ranges from slang-heavy/nonstandard speech through natural everyday
conversation to Shakespeare-like rhetoric. `humorousness` ranges from serious,
philosophy-book reflection to relentless puns and sharp humorous lines.
`worldDynamic` ranges from quiet, still, minimally conversational scenes to
hectic movement and rapidly changing conversations. All four tuning values are
visible in the exact provider prompt.

**What should happen next?** sends a persistent `requestedDevelopment` with
each provider context until the selection changes. The default **Let faith
choose** sends no direction, and the exact active instruction remains visible
in the provider-request panel.

The app delegates all asset loading, placement, depth ordering, speech bubbles,
canvas work, and PNG encoding to `rendering/render-world.ts`.

The debugger retains a live `SimulationState` between steps. Editing the state
textarea uses the engine's reusable snapshot codec, which
validates and defensively copies complete state without replaying the mutations
that originally produced it. Unchanged textarea content therefore requires no
reconstruction; valid manual edits become the input to the next step.

After at least one returned action is applied, the debugger records the
decision summary and shows the 30 most recently retained summaries in
**Simulated event summaries**. The prompt receives only the recent count
configured by `decisionHistoryLimit`.

The app uses `OpenAIProvider` by default. To try another provider, instantiate
it in `app.ts`; the remainder of the debugger depends only on `decide(context)`.
