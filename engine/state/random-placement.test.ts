import assert from "node:assert/strict";
import test from "node:test";
import { placeCharactersRandomly, Posture, SimulationState } from "./index.js";
import type { Scene } from "./index.js";

const scene: Scene = {
  id: "test-room",
  positions: [
    { id: "floor", allowedPostures: [Posture.STANDING], allowedDirections: ["front"] },
    { id: "chair", allowedPostures: [Posture.SITTING], allowedDirections: ["left", "right"] },
    { id: "bench", allowedPostures: [Posture.SITTING], allowedDirections: ["right"] },
  ],
  conversationPairs: [],
};

test("random placement uses distinct positions and their declared affordances", () => {
  const state = new SimulationState({ scene, characterIds: ["felix", "grace"] });
  const values = [0, 0, 0, 0, 0];
  const snapshot = placeCharactersRandomly({ state, scene, characterIds: ["felix", "grace"], random: () => values.shift() ?? 0 });
  const felix = snapshot.characters.felix;
  const grace = snapshot.characters.grace;

  assert.notEqual(felix.positionId, grace.positionId);
  for (const character of [felix, grace]) {
    const position = scene.positions.find(({ id }) => id === character.positionId)!;
    assert.ok(position.allowedPostures!.includes(character.posture));
    assert.ok(position.allowedDirections!.includes(character.facing));
  }
});

test("random placement is deterministic with an injected source", () => {
  const place = () => {
    const state = new SimulationState({ scene, characterIds: ["felix", "grace"] });
    return placeCharactersRandomly({ state, scene, characterIds: ["felix", "grace"], random: () => 0.25 });
  };
  assert.deepEqual(place().characters, place().characters);
});

test("random placement rejects insufficient positions and invalid random values", () => {
  const state = new SimulationState({ scene, characterIds: ["felix", "grace"] });
  assert.throws(() => placeCharactersRandomly({ state, scene: { ...scene, positions: [scene.positions[0]] }, characterIds: ["felix", "grace"] }), /Cannot place/);
  assert.throws(() => placeCharactersRandomly({ state, scene, characterIds: ["felix"], random: () => 1 }), /0 inclusive to 1 exclusive/);
});
