import assert from "node:assert/strict";
import test from "node:test";
import { Activity, Posture, SimulationState } from "./index.js";

const scene = {
  id: "library",
  positions: [
    { id: "desk", capacity: 2, allowedPostures: [Posture.SITTING], allowedDirections: ["left", "right"] as ("left" | "right")[] },
    { id: "window", allowedPostures: [Posture.STANDING] },
    { id: "sofa", allowedPostures: [Posture.SITTING, Posture.SLEEPING] },
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

test("decision history retains every summary", () => {
  const state = makeState();
  for (let index = 0; index < 22; index += 1) {
    state.recordDecision(`step ${index}`);
  }
  assert.equal(state.snapshot().decisionHistory.length, 22);
  assert.equal(state.snapshot().decisionHistory[0], "step 0");
  assert.throws(() => state.recordDecision("  "), /non-empty summary/);
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
  state.endConversation("stars");
  assert.equal(state.snapshot().characters["felix-adebayo"].activity, Activity.IDLE);
});

test("relationships are constrained", () => {
  const state = makeState();
  state.updateRelationship("felix-adebayo", "grace-kim", { affinity: 0.4, trust: -0.2 });
  const snapshot = state.snapshot();
  assert.deepEqual(snapshot.characters["felix-adebayo"].relationships["grace-kim"], { affinity: 0.4, trust: -0.2 });
  assert.throws(() => state.updateRelationship("felix-adebayo", "grace-kim", { affinity: 2 }), /between/);
});
