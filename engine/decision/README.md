# AI Decision Layer

The AI layer proposes a small, typed decision; it never edits simulation state
directly. `SimulationDirector` builds a complete context from the scene
definition, all selected character profiles, and the current state snapshot
(including memories, events, relationships, and conversation history), sends it
to an `AIProvider`, validates the result with `WorldRules`, then applies valid
changes through `SimulationState`.

```js
import { OpenAIProvider } from "../provider/index.js";
import { SimulationDirector } from "./simulation-director.js";

const provider = new OpenAIProvider({ apiKey: runtimeApiKey });
const director = new SimulationDirector({ provider, scene, profiles, state });
const { decision, snapshot } = await director.decideNext();
```

## Rule boundary

`WorldRules` is the source of truth for a single step. It permits `say`,
`remember`, `setMood`, `updateRelationship`, `placeCharacter`, `setPosture`,
`startConversation`, `endConversation`, and `addEvent` changes. It rejects
unknown ids, invalid mood/relationship ranges, unsupported postures, occupied
places, malformed conversations, and more than one `say` change for the same
conversation per step. `SimulationState` validates again when applying each
change.

Add a new action in three places: `WorldRules` validation, `applyDecision`, and
the rules description supplied by `buildDecisionContext`. This keeps provider
implementations interchangeable while the simulation—not the model—owns its
rules.

## OpenAI adapter

`OpenAIProvider` uses the Responses API and JSON Schema response formatting. It
has no SDK dependency and accepts an injectable `fetch` for tests. It defaults
to `gpt-5.6-sol`, but accepts a `model` override. Supply an API key at runtime;
do not commit a key. The adapter requests JSON, while local rules remain the
final authority over semantic validity.
