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

`worldTendency` is a prompt-facing narrative prior from `-1` to `1`, defaulting
to `0`. At `1`, the model is instructed to keep outcomes consistently peaceful,
cooperative, happy, and fortunate. At `-1`, every step should introduce
conflict, misfortune, danger, or a meaningful setback. Intermediate values
interpolate the peaceful/fortunate versus adverse/conflict bias. This knob does
not bypass world rules or character causality; it influences which valid,
plausible development the model chooses.

`pomposity` controls spoken style from slang-heavy, deliberately nonstandard
speech at `-1` to ornate, Shakespeare-like rhetoric at `1`. Its neutral default
strongly requests credible everyday dialogue: contractions, fragments, direct
answers, ordinary vocabulary, hesitations, and uneven turns rather than poetic
monologues. Vocabulary and fluency should fit character background without
equating natural or simple speech with low intelligence.

`worldDynamic` controls pacing from exceptionally quiet and still at `-1` to
intensely hectic at `1`. Quiet worlds favor staying put, listening, pauses, and
subtle state changes; hectic worlds favor movement, interruptions, rapid
activity changes, and conversations that start and stop quickly. Even at `-1`,
each simulation step still requires a meaningful change.

This knob changes the concrete pacing values embedded in the prompt rather than
adding flavor text alone. At `+1`, steps target 4–8 changes, conversations target
1–3 spoken turns, and an active conversation at three turns is explicitly ended
instead of continued. At `-1`, steps target 1–2 changes, conversation starts
fall to 10% of eligible steps, and silence/listening become substantially more
likely. At `0`, the configured baseline pacing values are preserved.

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
   its participants. They must occupy a declared conversation pair; starting
   automatically turns them to the pair's configured facings.
2. `say` records one participant's exact spoken `text` using that id as
   `conversationId`. It may immediately follow `startConversation` in the same
   decision.
3. `endConversation` releases its participants and marks the conversation
   `closing`, preserving its final beat for rendering. Closing conversations
   accept no more beats and are removed automatically before the next step.

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

Only one event can be active. It is rendered for the frame produced by the
decision that added it, then expires automatically before the next decision.
The model may add it alongside other actions when the occurrence is important
to understanding the world.

Add a new action in three places: `WorldRules` validation, `applyDecision`, and
the `ACTION_CATALOG` supplied by `buildDecisionContext`. This keeps provider
implementations interchangeable while the simulation—not the model—owns its
rules.

## OpenAI adapter

`OpenAIProvider` uses the Responses API and JSON Schema response formatting. It
has no SDK dependency and accepts an injectable `fetch` for tests. It defaults
to the latency-oriented `gpt-5.6-luna`, but accepts a `model` override. Requests
use low text verbosity and an 800-token output ceiling. Supply an API key at
runtime; do not commit a key. The adapter requests JSON, while local rules remain
the final authority over semantic validity.
