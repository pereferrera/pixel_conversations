import assert from "node:assert/strict";
import test from "node:test";
import { Posture, SimulationState } from "../state/index.js";
import { OpenAIProvider } from "../provider/index.js";
import { SimulationDirector } from "./simulation-director.js";
import { WorldRuleViolation, WorldRules } from "./world-rules.js";

const scene = { id: "cafe", positions: [
  { id: "chair", allowedPostures: [Posture.SITTING] },
  { id: "counter", allowedPostures: [Posture.STANDING] },
] };
const profiles = [
  { id: "felix-adebayo", identity: { name: "Felix" } },
  { id: "grace-kim", identity: { name: "Grace" } },
];

function setup() {
  const state = new SimulationState({ scene, characterIds: profiles.map(({ id }) => id), startedAt: "2026-01-01T00:00:00.000Z" });
  state.placeCharacter("felix-adebayo", "chair", Posture.SITTING);
  state.placeCharacter("grace-kim", "counter", Posture.STANDING);
  state.startConversation({ id: "stars", participants: ["felix-adebayo", "grace-kim"] });
  return state;
}

test("world rules reject two simultaneous turns in one conversation", () => {
  const state = setup();
  const rules = new WorldRules({ scene, state: state.snapshot() });
  assert.throws(() => rules.assertValid({ summary: "too much", changes: [
    { type: "say", conversationId: "stars", speakerId: "felix-adebayo", text: "Hello" },
    { type: "say", conversationId: "stars", speakerId: "grace-kim", text: "Hi" },
  ] }), WorldRuleViolation);
});

test("director gives complete context to a provider and applies only valid changes", async () => {
  const state = setup();
  let context;
  const provider = { async decide(received) {
    context = received;
    return { summary: "Felix shares an observation.", changes: [
      { type: "say", conversationId: "stars", speakerId: "felix-adebayo", text: "The sky is clear tonight." },
      { type: "remember", characterId: "grace-kim", memory: { summary: "Felix is planning to stargaze.", tags: ["felix-adebayo"] } },
      { type: "setMood", characterId: "felix-adebayo", mood: { valence: 0.3 } },
    ] };
  } };
  const result = await new SimulationDirector({ provider, scene, profiles, state }).decideNext();
  assert.equal(context.scene.id, "cafe");
  assert.equal(context.characters.length, 2);
  assert.equal(context.state.conversations.stars.turns.length, 0);
  assert.equal(result.snapshot.conversations.stars.turns.length, 1);
  assert.equal(result.snapshot.characters["grace-kim"].memories.length, 1);
  assert.equal(result.snapshot.characters["felix-adebayo"].mood.valence, 0.3);
});

test("OpenAI provider sends the context using a structured Responses request", async () => {
  let request;
  const provider = new OpenAIProvider({ apiKey: "test-key", model: "test-model", fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: '{"summary":"quiet","changes":[]}' }) };
  } });
  const result = await provider.decide({ scene, characters: profiles, state: setup().snapshot(), rules: {} });
  assert.equal(request.model, "test-model");
  assert.equal(request.text.format.type, "json_schema");
  assert.deepEqual(result, { summary: "quiet", changes: [] });
});
