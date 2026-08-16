import assert from "node:assert/strict";
import test from "node:test";
import { Activity, ConversationStatus, DECISION_HISTORY_LIMIT, deserializeSimulationState, EmotionalState, Posture, restoreSimulationState, serializeSimulationState, SimulationState } from "./index.js";

const scene = {
  id: "library",
  positions: [
    { id: "desk", capacity: 2, allowedPostures: [Posture.SITTING], allowedDirections: ["left", "right"] as ("left" | "right")[] },
    { id: "window", allowedPostures: [Posture.STANDING] },
    { id: "sofa", allowedPostures: [Posture.SITTING] },
  ],
  conversationPairs: [
    { positions: ["desk", "sofa"] as [string, string], facings: ["left", "right"] as ["left", "right"] },
  ],
};

function makeState() {
  return new SimulationState({ scene, characterIds: ["felix-adebayo", "grace-kim"], memoryLimit: 2 });
}

test("placements observe posture rules and single occupancy", () => {
  const state = makeState();
  state.placeCharacter("felix-adebayo", "desk", Posture.SITTING);
  assert.equal(state.snapshot().characters["felix-adebayo"].facing, "left");
  assert.throws(() => state.placeCharacter("felix-adebayo", "desk", Posture.SITTING, "front"), /not allowed/);
  assert.throws(() => state.placeCharacter("grace-kim", "desk", Posture.SITTING), /occupied/);
  state.placeCharacter("grace-kim", "sofa", Posture.SITTING, "right");
  assert.equal(state.snapshot().characters["felix-adebayo"].positionId, "desk");
  assert.throws(() => state.setPosture("felix-adebayo", Posture.STANDING), /not allowed/);
  assert.throws(() => state.placeCharacter("grace-kim", "window", Posture.SITTING), /not allowed/);
});

test("memories drop the least important item and snapshots cannot mutate state", () => {
  const state = makeState();
  state.remember("felix-adebayo", { summary: "first", importance: 0.2 });
  state.remember("felix-adebayo", { summary: "second" });
  state.remember("felix-adebayo", { summary: "third" });
  state.remember("felix-adebayo", { summary: "forgettable", importance: 0.1 });
  const snapshot = state.snapshot();
  assert.deepEqual(snapshot.characters["felix-adebayo"].memories.map(({ summary }) => summary), ["second", "third"]);
  assert.deepEqual(snapshot.characters["felix-adebayo"].memories[0], { summary: "second", importance: 0.5 });
  snapshot.characters["felix-adebayo"].mood.energy = 0;
  assert.equal(state.snapshot().characters["felix-adebayo"].mood.energy, 0.5);
});

test("decision history retains only the most recent summaries", () => {
  const state = makeState();
  for (let index = 0; index < DECISION_HISTORY_LIMIT + 2; index += 1) {
    state.recordDecision(`step ${index}`);
  }
  assert.equal(state.snapshot().decisionHistory.length, DECISION_HISTORY_LIMIT);
  assert.equal(state.snapshot().decisionHistory[0], "step 2");
  assert.equal(state.snapshot().decisionHistory.at(-1), `step ${DECISION_HISTORY_LIMIT + 1}`);
  assert.throws(() => state.recordDecision("  "), /non-empty summary/);
});

test("snapshot restoration retains only the most recent decision summaries", () => {
  const snapshot = makeState().snapshot();
  snapshot.decisionHistory = Array.from({ length: DECISION_HISTORY_LIMIT + 2 }, (_, index) => `step ${index}`);

  const restored = restoreSimulationState(snapshot, { scene, memoryLimit: 2 }).snapshot();

  assert.equal(restored.decisionHistory.length, DECISION_HISTORY_LIMIT);
  assert.equal(restored.decisionHistory[0], "step 2");
  assert.equal(restored.decisionHistory.at(-1), `step ${DECISION_HISTORY_LIMIT + 1}`);
});

test("conversations update participant activity and validate beats", () => {
  const state = makeState();
  state.placeCharacter("felix-adebayo", "desk", Posture.SITTING);
  state.placeCharacter("grace-kim", "sofa", Posture.SITTING, "right");
  state.startConversation({ id: "stars", participants: ["felix-adebayo", "grace-kim"], topic: "astronomy" });
  assert.equal(state.snapshot().characters["felix-adebayo"].activity, Activity.TALKING);
  state.addConversationTurn("stars", { speakerId: "felix-adebayo", text: "The sky is clear tonight." });
  state.pauseConversation("stars");
  assert.deepEqual(state.snapshot().conversations.stars.beats.map(({ type }) => type), ["say", "pause"]);
  assert.throws(() => state.addConversationTurn("stars", { speakerId: "someone-else", text: "Hello" }), /not part/);
  assert.throws(() => state.placeCharacter("grace-kim", "window", Posture.STANDING), /End conversation/);
  state.remember("felix-adebayo", { summary: "Grace listened to his observation.", importance: 0.7 });
  state.endConversation("stars");
  const snapshot = state.snapshot();
  assert.equal(snapshot.characters["felix-adebayo"].activity, Activity.IDLE);
  assert.equal(snapshot.characters["felix-adebayo"].conversationId, null);
  assert.equal(snapshot.conversations.stars.status, ConversationStatus.CLOSING);
  assert.deepEqual(snapshot.conversations.stars.beats.map(({ type }) => type), ["say", "pause"]);
  assert.throws(() => state.addConversationTurn("stars", { speakerId: "felix-adebayo", text: "One more thing." }), /No active conversation/);
  state.finalizeClosingConversations();
  assert.equal(state.snapshot().conversations.stars, undefined);
  assert.deepEqual(snapshot.characters["felix-adebayo"].memories, [
    { summary: "Grace listened to his observation.", importance: 0.7 },
  ]);
});

test("state JSON round-trips a closing conversation after its participants move apart", () => {
  const state = makeState();
  state.placeCharacter("felix-adebayo", "desk", Posture.SITTING);
  state.placeCharacter("grace-kim", "sofa", Posture.SITTING);
  state.startConversation({ id: "finished-chat", participants: ["felix-adebayo", "grace-kim"], topic: "notes" });
  state.addConversationTurn("finished-chat", { speakerId: "grace-kim", text: "Let's leave it there." });
  state.endConversation("finished-chat");
  state.placeCharacter("felix-adebayo", "window", Posture.STANDING);
  state.placeCharacter("grace-kim", "desk", Posture.SITTING);

  const json = serializeSimulationState(state, 2);
  const restored = deserializeSimulationState(json, { scene, memoryLimit: 2 });
  assert.deepEqual(restored.snapshot(), state.snapshot());
  restored.beginSimulationIteration();
  assert.equal(restored.snapshot().conversations["finished-chat"], undefined);
});

test("snapshot restoration validates active state and defensively copies its input", () => {
  const state = makeState();
  state.placeCharacter("felix-adebayo", "desk", Posture.SITTING);
  state.placeCharacter("grace-kim", "sofa", Posture.SITTING);
  state.startConversation({ id: "active-chat", participants: ["felix-adebayo", "grace-kim"] });
  const snapshot = state.snapshot();
  const restored = restoreSimulationState(snapshot, { scene, memoryLimit: 2 });
  snapshot.characters["felix-adebayo"].mood.energy = 0;
  assert.equal(restored.snapshot().characters["felix-adebayo"].mood.energy, 0.5);

  const invalid = state.snapshot();
  invalid.characters["grace-kim"].positionId = "window";
  invalid.characters["grace-kim"].posture = Posture.STANDING;
  invalid.characters["grace-kim"].facing = "front";
  assert.throws(() => restoreSimulationState(invalid, { scene, memoryLimit: 2 }), /Active conversation active-chat/);
});

test("relationships are constrained", () => {
  const state = makeState();
  state.updateRelationship("felix-adebayo", "grace-kim", { affinity: 0.4, trust: -0.2 });
  const snapshot = state.snapshot();
  assert.deepEqual(snapshot.characters["felix-adebayo"].relationships["grace-kim"], { affinity: 0.4, trust: -0.2 });
  assert.throws(() => state.updateRelationship("felix-adebayo", "grace-kim", { affinity: 2 }), /between/);
});

test("conversation start turns participants to their declared pair facings", () => {
  const state = makeState();
  state.placeCharacter("felix-adebayo", "desk", Posture.SITTING, "right");
  state.placeCharacter("grace-kim", "sofa", Posture.SITTING, "left");
  state.startConversation({ id: "turn-to-talk", participants: ["felix-adebayo", "grace-kim"] });
  assert.equal(state.snapshot().characters["felix-adebayo"].facing, "left");
  assert.equal(state.snapshot().characters["grace-kim"].facing, "right");
});

test("an event lasts for one rendered iteration and a new event replaces it", () => {
  const state = makeState();
  state.addEvent({ type: "lights-flicker", summary: "The library lights flicker.", participants: ["felix-adebayo"] });
  assert.deepEqual(state.snapshot().event, {
    type: "lights-flicker",
    summary: "The library lights flicker.",
    participants: ["felix-adebayo"],
  });
  state.addEvent({ type: "lights-steady", summary: "The lights become steady again." });
  assert.equal(state.snapshot().event?.type, "lights-steady");
  state.beginSimulationIteration();
  assert.equal(state.snapshot().event, null);
});

test("emotional states are constrained while continuous mood dimensions remain available", () => {
  const state = makeState();
  state.setMood("felix-adebayo", { valence: -0.4, emotionalState: EmotionalState.SAD });
  assert.deepEqual(state.snapshot().characters["felix-adebayo"].mood, {
    valence: -0.4,
    energy: 0.5,
    socialNeed: 0.5,
    emotionalState: EmotionalState.SAD,
  });
  state.setMood("felix-adebayo", { emotionalState: EmotionalState.AFRAID });
  assert.equal(state.snapshot().characters["felix-adebayo"].mood.emotionalState, EmotionalState.AFRAID);
  assert.throws(() => state.setMood("felix-adebayo", { emotionalState: "excited" as EmotionalState }), /happy, sad, angry, afraid, or neutral/);
});

test("sleeping is an activity allowed only while sitting", () => {
  const state = makeState();
  state.placeCharacter("felix-adebayo", "window", Posture.STANDING);
  assert.throws(() => state.setActivity("felix-adebayo", Activity.SLEEPING), /only while sitting/);
  state.placeCharacter("felix-adebayo", "desk", Posture.SITTING);
  state.setActivity("felix-adebayo", Activity.SLEEPING);
  assert.equal(state.snapshot().characters["felix-adebayo"].activity, Activity.SLEEPING);
  assert.throws(() => state.startConversation({ id: "nap-chat", participants: ["felix-adebayo", "grace-kim"] }), /sleeping/);
  state.setActivity("felix-adebayo", Activity.IDLE);
  assert.equal(state.snapshot().characters["felix-adebayo"].activity, Activity.IDLE);
});
