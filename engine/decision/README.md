# AI Decision Layer

The AI layer proposes a small, typed decision; it never edits simulation state
directly. `SimulationDirector` builds a complete context from the scene
definition, all selected character profiles, and the current state snapshot
(including memories, events, relationships, and conversation history), sends it
to an `AIProvider`, validates the result with `WorldRules`, then applies valid
changes through `SimulationState`. Each step requires at least one change. Once
applied, its summary joins the complete state history. By default, only the
newest 20 entries are included in the next prompt, oldest to newest.

Simulation pacing lives in `DEFAULT_SIMULATION_TUNING` in
`simulation-tuning.ts`. It controls prompt history length, typical change and
conversation lengths, fallback speech/listening/same-speaker tendencies, memory
capacity, conversation-end memory behavior, and extraordinary-memory
thresholds. Pass a partial `tuning` object to `OpenAIProvider` to override
prompt-facing defaults for one provider instance. Pass `memoryLimit` when
constructing `SimulationState` to override its centrally sourced memory
capacity.

Speaker selection is personality-first. The model weighs complete profiles,
conversation style, mood, social need, relationships, topic, recent speakers,
pauses, and unanswered dialogue. It must not alternate speakers mechanically:
shy characters may mostly listen and expressive characters may speak for
several consecutive beats. Numeric conversation settings are fallback priors,
not world-level assignments to individual characters.

The decision context includes a field-level contract for every allowed action
and a compact scene-position catalog with semantic labels, legal postures and
directions, and current occupancy. Renderer-only coordinates and furniture
bindings are deliberately omitted.

Every returned change must use `type` as its discriminator. Other discriminator
fields are invalid and are not rewritten by the provider.

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
`startConversation`, `pauseConversation`, `endConversation`, and `addEvent`
changes. It rejects
unknown ids, invalid mood/relationship ranges, unsupported postures or facing
directions, occupied
places, malformed conversations, empty steps, and more than one `say` change
for the same conversation per step. `SimulationState` validates again when
applying each change.

Conversation lifecycle uses three distinct actions:

1. `startConversation` creates the conversation and assigns its new `id` to
   its participants.
2. `say` records one participant's exact spoken `text` using that id as
   `conversationId`. It may immediately follow `startConversation` in the same
   decision.
3. `endConversation` closes the active conversation and releases its
   participants.

`pauseConversation` adds an explicit active-conversation beat in which nobody
speaks. It makes attentive silence representable without inventing an event,
mood change, or empty simulation step.

`remember` is intentionally rare. Conversation endings normally produce one
concise memory for each participant; otherwise only extraordinary events or
sentences should become memories. Memory actions accept only `summary` and
`importance`.

`addEvent` records non-conversation world occurrences only. It cannot encode
speech or replace any conversation lifecycle action; conversation-like event
types are rejected locally.

Add a new action in three places: `WorldRules` validation, `applyDecision`, and
the `ACTION_CATALOG` supplied by `buildDecisionContext`. This keeps provider
implementations interchangeable while the simulation—not the model—owns its
rules.

## OpenAI adapter

`OpenAIProvider` uses the Responses API and JSON Schema response formatting. It
has no SDK dependency and accepts an injectable `fetch` for tests. It defaults
to `gpt-5.6-sol`, but accepts a `model` override. Supply an API key at runtime;
do not commit a key. The adapter requests JSON, while local rules remain the
final authority over semantic validity.
