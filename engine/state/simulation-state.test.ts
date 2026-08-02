import assert from "node:assert/strict";
import test from "node:test";
import { Activity, Posture, SimulationState } from "./index.js";

const scene = {
  id: "library",
  positions: [
    { id: "desk", capacity: 2, allowedPostures: [Posture.SITTING] },
    { id: "window", allowedPostures: [Posture.STANDING] },
    { id: "sofa", allowedPostures: [Posture.SITTING, Posture.SLEEPING] },
  ],
};

function makeState() {
  return new SimulationState({ scene, characterIds: ["felix-adebayo", "grace-kim"], memoryLimit: 2, startedAt: "2026-01-01T00:00:00.000Z" });
}

test("placements observe posture rules and single occupancy", () => {
  const state = makeState();
  state.placeCharacter("felix-adebayo", "desk", Posture.SITTING);
  assert.throws(() => state.placeCharacter("grace-kim", "desk", Posture.SITTING), /occupied/);
  state.placeCharacter("grace-kim", "sofa", Posture.SITTING);
  assert.equal(state.snapshot().characters["felix-adebayo"].positionId, "desk");
  assert.throws(() => state.setPosture("felix-adebayo", Posture.STANDING), /not allowed/);
  assert.throws(() => state.placeCharacter("grace-kim", "window", Posture.SITTING), /not allowed/);
});

test("memories are bounded and snapshots cannot mutate state", () => {
  const state = makeState();
  state.remember("felix-adebayo", { summary: "first", importance: 0.2 });
  state.remember("felix-adebayo", { summary: "second" });
  state.remember("felix-adebayo", { summary: "third" });
  const snapshot = state.snapshot();
  assert.deepEqual(snapshot.characters["felix-adebayo"].memories.map(({ summary }) => summary), ["second", "third"]);
  snapshot.characters["felix-adebayo"].mood.energy = 0;
  assert.equal(state.snapshot().characters["felix-adebayo"].mood.energy, 0.5);
});

test("conversations update participant activity and validate turns", () => {
  const state = makeState();
  state.placeCharacter("felix-adebayo", "desk", Posture.SITTING);
  state.placeCharacter("grace-kim", "sofa", Posture.SITTING);
  state.startConversation({ id: "stars", participants: ["felix-adebayo", "grace-kim"], topic: "astronomy" });
  assert.equal(state.snapshot().characters["felix-adebayo"].activity, Activity.TALKING);
  state.addConversationTurn("stars", { speakerId: "felix-adebayo", text: "The sky is clear tonight." });
  assert.throws(() => state.addConversationTurn("stars", { speakerId: "someone-else", text: "Hello" }), /not part/);
  state.endConversation("stars");
  assert.equal(state.snapshot().characters["felix-adebayo"].activity, Activity.IDLE);
});

test("time pauses and relationships are constrained", () => {
  const state = makeState();
  state.tick(500);
  state.setPaused(true);
  state.tick(500);
  state.updateRelationship("felix-adebayo", "grace-kim", { affinity: 0.4, trust: -0.2 });
  const snapshot = state.snapshot();
  assert.equal(snapshot.elapsedMs, 500);
  assert.deepEqual(snapshot.characters["felix-adebayo"].relationships["grace-kim"], { affinity: 0.4, trust: -0.2 });
  assert.throws(() => state.updateRelationship("felix-adebayo", "grace-kim", { affinity: 2 }), /between/);
});
