# State machine debugger

This local browser utility sends the current JSON world to an `AIProvider`.
It renders the current world as a PNG above the diagnostics and keeps the full
provider boundary visible: the exact request and prompts, the
untouched response body, the parsed actions, and the resulting world state.
Parsed OpenAI changes must use the state API's canonical `type` discriminator.
Response status, OpenAI request id, and processing time appear beside the raw
response when the API supplies them. An invalid action is logged with its index
in the browser console and skipped; later actions are still attempted against
the latest state.

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

Optionally change the model and click **Simulate next step**. The browser sends
the provider request to the same-origin local endpoint at `/api/responses`.
The local server adds `OPENAI_API_KEY` and forwards it to OpenAI, avoiding CORS
and keeping the secret out of browser code. The server binds to loopback only
and is intended for local debugging, not deployment.

If `OPENAI_API_KEY` is absent from both the shell and `debug/.env`, the endpoint
returns a configuration error.

## World JSON format

The bundled `example-world.json` loads automatically. Use **World JSON** to
load another local file. A file contains:

- `scene`: the state API's scene definition, including concrete positions.
- `profiles`: character profiles for every character in the state.
- `rendering`: the full scene-definition URL and a character-id-to-manifest
  URL map consumed by the standalone rendering library.
- `state`: a complete `SimulationSnapshot`, including `decisionHistory`, the
  complete list of applied decision summaries.

The bundled example uses the exact runtime positions from
`scenes/community-cafe/scene.json`. Felix and Grace both have complete
production sprite manifests and can be placed standing or sitting. Seated
characters may use the sleeping activity and its dedicated sprite.

On each page reload, the bundled example keeps Felix and Grace but initializes
them at distinct random scene positions. Posture and facing are selected only
from each position's declared affordances. This uses the reusable engine helper
`placeCharactersRandomly`; uploaded world files retain their supplied state.

Hover a rendered character to inspect their concrete emotional state plus
valence, energy, and social need. The debugger uses the renderer's reusable
`attachCharacterMoodHover` binding rather than debugger-specific hit testing.

The world-tendency slider passes an engine `SimulationTuning.worldTendency`
value into each provider request. Use `-1` to stress conflict and adverse
developments, `0` for balanced outcomes, and `+1` for consistently peaceful and
fortunate developments. The exact prompt is visible in the provider-request
panel.

Two additional `-1..1` sliders expose the engine's dialogue and pacing priors.
`pomposity` ranges from slang-heavy/nonstandard speech through natural everyday
conversation to Shakespeare-like rhetoric. `worldDynamic` ranges from quiet,
still, minimally conversational scenes to hectic movement and rapidly changing
conversations. All three tuning values are visible in the exact provider prompt.
The app delegates all asset loading, placement, depth ordering, speech bubbles,
canvas work, and PNG encoding to `rendering/render-world.ts`.

The snapshot is reconstructed through public `SimulationState` mutations when
it is loaded and before every step, so malformed or impossible initial state is
reported before an API request. The state textarea is editable; valid changes
there become the input to the next step.

After at least one returned action is applied, the debugger records the
decision summary and shows every retained summary in **Simulated event
summaries**. The prompt receives only the recent count configured by
`promptHistoryLimit`.

The app uses `OpenAIProvider` by default. To try another provider, instantiate
it in `app.ts`; the remainder of the debugger depends only on `decide(context)`.
