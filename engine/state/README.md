# Simulation State

`SimulationState` holds serializable runtime facts only: no profiles, artwork,
DOM references, AI clients, or rendering logic. The future engine changes it
through the mutation API; renderers and prompt builders consume `snapshot()`.

Each scene entry is one concrete, single-occupancy place: a seat, bed, stool,
or named standing spot. It may constrain both posture and facing direction and
may carry a renderer-only binding to a standing baseline or furniture seat.
A character may move to an occupied place only after its occupant moves away.

```js
import { Activity, EmotionalState, Posture, SimulationState } from "./engine/state/index.js";

const state = new SimulationState({
  scene: {
    id: "cafe",
    positions: [
      { id: "chair-1/seat", kind: "seat", allowedPostures: [Posture.SITTING], allowedDirections: ["left", "right"] },
      { id: "floor-center", kind: "standing", allowedPostures: [Posture.STANDING], allowedDirections: ["front", "left", "right"] },
    ],
  },
  characterIds: ["felix-adebayo", "grace-kim"],
});
```

## State shape

A snapshot contains the full global scene state and each character's current
runtime state. Stable character ids refer to profiles in `/characters`.

```js
{
  version: 1,
  sceneId: "cafe",
  decisionHistory: [
    "Felix joined Grace near the counter.",
    "They began discussing astronomy.",
  ], // all applied decision summaries
  characters: {
    "felix-adebayo": {
      positionId: "window-chair",
      posture: "sitting",       // standing | sitting
      facing: "left",           // front | left | right
      activity: "talking",      // idle | talking | sleeping
      mood: {
        valence: 0.4,            // pleasantness: -1 unpleasant, 0 neutral, 1 pleasant
        energy: 0.65,            // 0 low to 1 high
        socialNeed: 0.3,         // 0 satisfied to 1 seeking company
        emotionalState: "happy", // happy | sad | angry | neutral
      },
      memories: [{
        summary: "Grace recommended a late-night radio programme.",
        importance: 0.7,         // 0 to 1
      }],
      relationships: {
        "grace-kim": { affinity: 0.3, trust: 0.1 }, // each -1 to 1
      },
      conversationId: "stargazing",
    },
    "grace-kim": {
      positionId: "counter-spot",
      posture: "standing",
      activity: "talking",
      mood: { valence: 0.2, energy: 0.8, socialNeed: 0.5, emotionalState: "neutral" },
      memories: [],
      relationships: {},
      conversationId: "stargazing",
    },
  },
  conversations: {
    stargazing: {
      id: "stargazing",
      status: "active",
      participants: ["felix-adebayo", "grace-kim"],
      topic: "astronomy",
      beats: [
        { type: "say", speakerId: "felix-adebayo", text: "The sky is clear tonight." },
        { type: "pause" },
      ],
    },
  },
  event: { type: "inspiration", summary: "Felix notices a familiar constellation.", participants: ["felix-adebayo"] },
}
```

## Explicit models

`Mood` and `Relationship` are exported classes which document and validate the
state shapes. `valence` means how pleasant or unpleasant a character feels;
it is not a measure of energy. Add a new field to the relevant class and its
field map in `simulation-state.ts` to make it available to mutation methods.

- `Mood`: `valence`, `energy`, `socialNeed`, and `emotionalState`. The continuous
  dimensions retain nuance; `EmotionalState` restricts the visible concrete
  emotion to `happy`, `sad`, `angry`, or `neutral`.
- `Relationship`: directed `affinity` and `trust`, both from -1 to 1. Negative
  values represent an unfavourable view; zero is neutral; positive is favourable.

## Mutations

Use `placeCharacter`, `setPosture`, `setActivity`, `setMood`, `remember`,
`updateRelationship`, conversation methods, and `addEvent` rather than changing
a snapshot. Mutations validate ids, posture and facing support, one-person places, value
ranges, active-conversation membership, and bounded memories. Applied decisions
are recorded with `recordDecision(summary)` and retained in full. Prompt
builders independently select the configured number of recent summaries.

Posture describes body placement and is limited to standing or sitting.
Sleeping is an activity, is valid only while sitting, and uses the existing
sitting-sleeping artwork. Talking activity is controlled by conversation
lifecycle mutations rather than set directly.
Starting a conversation requires its participants to occupy a declared scene
pair and automatically turns them to that pair's configured facings.

The state intentionally has no world clock, timestamps, elapsed duration, or
pause flag. Beat-array order provides conversational ordering. Ending a
conversation releases its participants and marks it `closing`, retaining its
final beat through the rendered frame. Closing conversations are removed at
the start of the next simulation iteration. Durable information from the
exchange belongs in bounded character memories. User-facing pacing belongs to
the future renderer/application rather than this state machine.

Memories contain only `summary` and `importance`. Their default per-character
capacity comes from `DEFAULT_SIMULATION_TUNING.memoryLimitPerCharacter` and
may still be overridden with the `SimulationState` constructor's
`memoryLimit`. When capacity is exceeded, the least-important memory is
removed; ties remove the oldest array entry.

Conversation `beats` preserve ordered presentation state. A `say` beat stores
exact dialogue and its speaker; a `pause` beat records an active listening or
reflective step with no speech. Consecutive `say` beats may use the same
speaker.

## Random initial placement

`placeCharactersRandomly` is a reusable initializer for placing a supplied set
of characters at distinct scene positions. It chooses only postures and facing
directions declared by those positions and applies them through
`SimulationState.placeCharacter`. Pass a custom `random` function for seeded or
deterministic behavior in tests; it must return values from `0` inclusive to
`1` exclusive.
