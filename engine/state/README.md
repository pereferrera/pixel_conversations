# Simulation State

`SimulationState` holds serializable runtime facts only: no profiles, artwork,
DOM references, AI clients, or rendering logic. The future engine changes it
through the mutation API; renderers and prompt builders consume `snapshot()`.

Each scene entry is one concrete, single-occupancy place: a chair, bed, stool,
or standing spot. A character may move to an occupied place only after its
current occupant has moved elsewhere.

```js
import { Posture, SimulationState } from "./engine/state/index.js";

const state = new SimulationState({
  scene: {
    id: "cafe",
    positions: [
      { id: "window-chair", allowedPostures: [Posture.SITTING] },
      { id: "counter-spot", allowedPostures: [Posture.STANDING] },
      { id: "back-room-bed", allowedPostures: [Posture.SLEEPING] },
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
  startedAt: "2026-08-02T18:00:00.000Z",
  elapsedMs: 34_000,
  paused: false,
  characters: {
    "felix-adebayo": {
      positionId: "window-chair",
      posture: "sitting",       // standing | sitting | sleeping
      activity: "talking",      // idle | talking | resting
      mood: {
        valence: 0.4,            // pleasantness: -1 unpleasant, 0 neutral, 1 pleasant
        energy: 0.65,            // 0 low to 1 high
        socialNeed: 0.3,         // 0 satisfied to 1 seeking company
      },
      memories: [{
        summary: "Grace recommended a late-night radio programme.",
        importance: 0.7,         // 0 to 1
        tags: ["grace-kim", "radio"],
        createdAt: "2026-08-02T18:00:20.000Z",
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
      mood: { valence: 0.2, energy: 0.8, socialNeed: 0.5 },
      memories: [],
      relationships: {},
      conversationId: "stargazing",
    },
  },
  conversations: {
    stargazing: {
      id: "stargazing",
      participants: ["felix-adebayo", "grace-kim"],
      topic: "astronomy",
      startedAt: "2026-08-02T18:00:25.000Z",
      turns: [{ speakerId: "felix-adebayo", text: "The sky is clear tonight.", at: "2026-08-02T18:00:34.000Z" }],
    },
  },
  events: [{ type: "inspiration", summary: "Felix notices a familiar constellation.", participants: ["felix-adebayo"], at: "2026-08-02T18:00:30.000Z" }],
}
```

## Explicit models

`Mood` and `Relationship` are exported classes which document and validate the
state shapes. `valence` means how pleasant or unpleasant a character feels;
it is not a measure of energy. Add a new field to the relevant class and its
field map in `simulation-state.js` to make it available to mutation methods.

- `Mood`: `valence`, `energy`, and `socialNeed`. Values are described above.
- `Relationship`: directed `affinity` and `trust`, both from -1 to 1. Negative
  values represent an unfavourable view; zero is neutral; positive is favourable.

## Mutations

Use `placeCharacter`, `setPosture`, `setMood`, `remember`,
`updateRelationship`, conversation methods, and `addEvent` rather than changing
a snapshot. Mutations validate ids, posture support, one-person places, value
ranges, active-conversation membership, and bounded memories. `tick(ms)` only
advances simulation time while unpaused; event and conversation scheduling
belongs to the future engine.
