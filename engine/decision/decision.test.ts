import assert from "node:assert/strict";
import test from "node:test";
import { Activity, ChangeType, ConversationStatus, EmotionalState, Posture, SimulationState } from "../state/index.js";
import type { SimulationDecision } from "../state/index.js";
import type { DecisionContext } from "./decision-context.js";
import { OpenAIProvider } from "../provider/index.js";
import { SimulationDirector } from "./simulation-director.js";
import { applyDecision, DECISION_JSON_SCHEMA, decisionPrompt, dynamicPacing, pomposityInstruction, worldDynamicInstruction, worldTendencyInstruction, WorldRuleViolation, WorldRules } from "./world-rules.js";
import { resolveSimulationTuning } from "./simulation-tuning.js";

const scene = { id: "cafe", positions: [
  { id: "chair", label: "Window chair", kind: "seat" as const, allowedPostures: [Posture.SITTING], allowedDirections: ["left", "right"] as ("left" | "right")[], renderer: { kind: "seat" as const, elementInstanceId: "chair-1", seatId: "seat" } },
  { id: "counter", allowedPostures: [Posture.STANDING] },
  { id: "bench", allowedPostures: [Posture.SITTING], allowedDirections: ["left", "right"] as ("left" | "right")[] },
], conversationPairs: [
  { positions: ["chair", "counter"] as [string, string], facings: ["right", "left"] as ["right", "left"] },
] };
const profiles = [
  { id: "felix-adebayo", identity: { name: "Felix" } },
  { id: "grace-kim", identity: { name: "Grace" } },
];

function setup() {
  const state = new SimulationState({ scene, characterIds: profiles.map(({ id }) => id) });
  state.placeCharacter("felix-adebayo", "chair", Posture.SITTING, "right");
  state.placeCharacter("grace-kim", "counter", Posture.STANDING, "left");
  state.startConversation({ id: "stars", participants: ["felix-adebayo", "grace-kim"] });
  return state;
}

function setupWithoutConversation() {
  const state = new SimulationState({ scene, characterIds: profiles.map(({ id }) => id) });
  state.placeCharacter("felix-adebayo", "chair", Posture.SITTING, "right");
  state.placeCharacter("grace-kim", "counter", Posture.STANDING, "front");
  return state;
}

test("world rules reject two simultaneous speech beats in one conversation", () => {
  const state = setup();
  const rules = new WorldRules({ scene, state: state.snapshot() });
  assert.throws(() => rules.assertValid({ summary: "nothing", changes: [] }), /at least one change/);
  assert.throws(() => rules.assertValid({ summary: "too much", changes: [
    { type: ChangeType.SAY, conversationId: "stars", speakerId: "felix-adebayo", text: "Hello" },
    { type: ChangeType.SAY, conversationId: "stars", speakerId: "grace-kim", text: "Hi" },
  ] }), WorldRuleViolation);
});

test("a conversation can start with exact spoken dialogue in the same decision", () => {
  const state = setupWithoutConversation();
  const decision: SimulationDecision = {
    summary: "Grace asks Felix about astronomy.",
    changes: [
      { type: ChangeType.PLACE_CHARACTER, characterId: "grace-kim", positionId: "counter", posture: Posture.STANDING, facing: "left" },
      { type: ChangeType.START_CONVERSATION, id: "astronomy-chat", participants: ["grace-kim", "felix-adebayo"], topic: "amateur astronomy" },
      { type: ChangeType.SAY, conversationId: "astronomy-chat", speakerId: "grace-kim", text: "What first drew you to amateur astronomy?" },
    ],
  };
  const snapshot = applyDecision(state, decision, new WorldRules({ scene, state: state.snapshot() }));
  assert.equal(snapshot.characters["grace-kim"].conversationId, "astronomy-chat");
  assert.equal(snapshot.characters["felix-adebayo"].conversationId, "astronomy-chat");
  assert.equal(snapshot.conversations["astronomy-chat"].topic, "amateur astronomy");
  assert.deepEqual(snapshot.conversations["astronomy-chat"].beats[0], {
    type: "say",
    speakerId: "grace-kim",
    text: "What first drew you to amateur astronomy?",
  });
});

test("a conversation cannot start until participants occupy an opposing scene pair", () => {
  const state = setupWithoutConversation();
  state.placeCharacter("grace-kim", "bench", Posture.SITTING, "left");
  const rules = new WorldRules({ scene, state: state.snapshot() });
  assert.throws(() => rules.assertValid({
    summary: "Grace speaks from an unrelated position.",
    changes: [{ type: ChangeType.START_CONVERSATION, id: "bad-chat", participants: ["grace-kim", "felix-adebayo"] }],
  }), /declared conversation pair/);
});

test("starting a conversation automatically turns an already positioned pair toward each other", () => {
  const state = setupWithoutConversation();
  const decision: SimulationDecision = {
    summary: "Grace gets Felix's attention.",
    changes: [{ type: ChangeType.START_CONVERSATION, id: "aisle-chat", participants: ["grace-kim", "felix-adebayo"] }],
  };
  const snapshot = applyDecision(state, decision, new WorldRules({ scene, state: state.snapshot() }));
  assert.equal(snapshot.characters["grace-kim"].facing, "left");
  assert.equal(snapshot.characters["felix-adebayo"].facing, "right");
  assert.equal(snapshot.characters["felix-adebayo"].conversationId, "aisle-chat");
});

test("an active conversation can advance with a silent listening beat", () => {
  const state = setup();
  const decision: SimulationDecision = {
    summary: "Felix quietly considers Grace's question.",
    changes: [{ type: ChangeType.PAUSE_CONVERSATION, conversationId: "stars" }],
  };
  const snapshot = applyDecision(state, decision, new WorldRules({ scene, state: state.snapshot() }));
  assert.deepEqual(snapshot.conversations.stars.beats, [{ type: "pause" }]);
  assert.equal(snapshot.characters["felix-adebayo"].conversationId, "stars");
});

test("conversation-like events are rejected in favor of lifecycle actions", () => {
  const state = setupWithoutConversation();
  const rules = new WorldRules({ scene, state: state.snapshot() });
  assert.throws(() => rules.assertValid({
    summary: "Grace approaches Felix.",
    changes: [{
      type: ChangeType.ADD_EVENT,
      event: {
        type: "conversation-overture",
        summary: "Grace asks Felix what first drew him to amateur astronomy.",
        participants: ["grace-kim", "felix-adebayo"],
      },
    }],
  }), /use startConversation, say, or endConversation/);
});

test("world rules allow at most one event per simulation step", () => {
  const state = setupWithoutConversation();
  const rules = new WorldRules({ scene, state: state.snapshot() });
  assert.throws(() => rules.assertValid({ summary: "Too many things happen.", changes: [
    { type: ChangeType.ADD_EVENT, event: { type: "flash", summary: "A flash lights the window." } },
    { type: ChangeType.ADD_EVENT, event: { type: "bang", summary: "A bang comes from outside." } },
  ] }), /at most one event/);
});

test("endConversation preserves a closing conversation until the next iteration", () => {
  const state = setup();
  const decision: SimulationDecision = {
    summary: "The astronomy conversation ends.",
    changes: [{ type: ChangeType.END_CONVERSATION, conversationId: "stars" }],
  };
  const snapshot = applyDecision(state, decision, new WorldRules({ scene, state: state.snapshot() }));
  assert.equal(snapshot.conversations.stars.status, ConversationStatus.CLOSING);
  assert.equal(snapshot.characters["felix-adebayo"].conversationId, null);
  assert.equal(snapshot.characters["grace-kim"].conversationId, null);
});

test("director removes closing conversations before asking for the next decision", async () => {
  const state = setup();
  state.addConversationTurn("stars", { speakerId: "felix-adebayo", text: "See you later." });
  state.endConversation("stars");
  state.addEvent({ type: "goodbye", summary: "The cafe door swings shut." });
  let context!: DecisionContext;
  const provider = { async decide(received: unknown): Promise<SimulationDecision> {
    context = received as DecisionContext;
    return { summary: "Grace changes her posture.", changes: [
      { type: ChangeType.SET_POSTURE, characterId: "grace-kim", posture: Posture.STANDING },
    ] };
  } };
  await new SimulationDirector({ provider, scene, profiles, state }).decideNext();
  assert.equal(context.state.conversations.stars, undefined);
  assert.equal(context.state.event, null);
});

test("director gives complete context to a provider and applies only valid changes", async () => {
  const state = setup();
  state.recordDecision("Grace arrived at the counter.");
  let context!: DecisionContext;
  const provider = { async decide(received: unknown): Promise<SimulationDecision> {
    context = received as DecisionContext;
    return { summary: "Felix shares an observation.", changes: [
      { type: ChangeType.SAY, conversationId: "stars", speakerId: "felix-adebayo", text: "The sky is clear tonight." },
      { type: ChangeType.REMEMBER, characterId: "grace-kim", memory: { summary: "Felix is planning to stargaze.", importance: 0.8 } },
      { type: ChangeType.SET_MOOD, characterId: "felix-adebayo", mood: { valence: 0.3, emotionalState: EmotionalState.HAPPY } },
    ] };
  } };
  const result = await new SimulationDirector({ provider, scene, profiles, state }).decideNext();
  assert.equal(context.scene.id, "cafe");
  assert.equal(context.scene.positions[0].occupiedBy, "felix-adebayo");
  assert.deepEqual(context.scene.conversationPairs, scene.conversationPairs);
  assert.equal("renderer" in context.scene.positions[0], false);
  assert.match(context.rules.actions.placeCharacter.fields.facing, /allowed/);
  assert.equal(context.rules.actions.placeCharacter.type, "placeCharacter");
  assert.equal(context.characters.length, 2);
  assert.equal(context.state.conversations.stars.beats.length, 0);
  assert.deepEqual(context.state.decisionHistory, ["Grace arrived at the counter."]);
  assert.equal(result.snapshot.conversations.stars.beats.length, 1);
  assert.deepEqual(result.snapshot.decisionHistory, ["Grace arrived at the counter.", "Felix shares an observation."]);
  assert.equal(result.snapshot.characters["grace-kim"].memories.length, 1);
  assert.equal(result.snapshot.characters["felix-adebayo"].mood.valence, 0.3);
  assert.equal(result.snapshot.characters["felix-adebayo"].mood.emotionalState, EmotionalState.HAPPY);
});

test("decision prompt requires changes and appends recent world summaries", () => {
  const prompt = decisionPrompt(
    { state: { decisionHistory: ["Grace arrived.", "Felix spoke."] } },
    { promptHistoryLimit: 1, typicalChangesMin: 3, typicalChangesMax: 5, conversationStartLikelihoodPercent: 60, conversationTurnLikelihoodPercent: 90 },
  );
  assert.match(prompt, /Usually make 3 to 5 meaningful changes\. Zero changes are not allowed\./);
  assert.match(prompt, /WORLD TENDENCY 0: Keep outcomes balanced/);
  assert.match(prompt, /IMPORTANT—write dialogue that sounds spoken by real people, not literary narration/);
  assert.match(prompt, /WORLD DYNAMIC 0:/);
  assert.match(prompt, /start a conversation in about 60%/);
  assert.match(prompt, /speech in about 90% of active-conversation steps/);
  assert.match(prompt, /Choose conversational participation primarily from each participant's full profile/);
  assert.match(prompt, /Do not alternate speakers mechanically/);
  assert.match(prompt, /"type":"pauseConversation"/);
  assert.match(prompt, /Memory is rare/);
  assert.match(prompt, /startConversation creates it, say records exact spoken words, and endConversation marks it closing/);
  assert.match(prompt, /deleted automatically before the next simulation step/);
  assert.match(prompt, /At most one event may be added per step/);
  assert.match(prompt, /expires before the next simulation step/);
  assert.match(prompt, /Physical connection is mandatory before speech/);
  assert.match(prompt, /What first drew you to amateur astronomy/);
  assert.match(prompt, /"type":"endConversation"/);
  assert.match(prompt, /action field contracts and position affordances/);
  assert.match(prompt, /Every change uses `type`, never `action`/);
  assert.match(prompt, /only allowed values are happy, sad, angry, and neutral/);
  assert.match(prompt, /hurtful words, disappointment, loss, rejection/);
  assert.match(prompt, /going without social contact for a while may trigger sad/);
  assert.match(prompt, /Sleeping is an activity, never a posture/);
  assert.match(prompt, /RECENT WORLD CHANGE SUMMARIES \(oldest to newest\):/);
  assert.match(prompt, /\["Felix spoke\."\]$/);
  assert.doesNotMatch(prompt, /Grace arrived/);
  assert.equal(DECISION_JSON_SCHEMA.properties.changes.minItems, 1);
});

test("world rules validate emotional states and seated sleeping", () => {
  const state = setupWithoutConversation();
  const rules = new WorldRules({ scene, state: state.snapshot() });
  assert.throws(() => rules.assertValid({ summary: "Unsupported feeling.", changes: [
    { type: ChangeType.SET_MOOD, characterId: "felix-adebayo", mood: { emotionalState: "excited" } },
  ] }), /emotionalState is not allowed/);
  assert.throws(() => rules.assertValid({ summary: "Grace tries to sleep standing.", changes: [
    { type: ChangeType.SET_ACTIVITY, characterId: "grace-kim", activity: Activity.SLEEPING },
  ] }), /only while sitting/);
  assert.doesNotThrow(() => rules.assertValid({ summary: "Felix falls asleep in the chair.", changes: [
    { type: ChangeType.SET_ACTIVITY, characterId: "felix-adebayo", activity: Activity.SLEEPING },
  ] }));
});

test("simulation tuning rejects invalid ranges", () => {
  assert.throws(() => resolveSimulationTuning({ worldTendency: -1.01 }), /worldTendency must be between -1 and 1/);
  assert.throws(() => resolveSimulationTuning({ worldTendency: 1.01 }), /worldTendency must be between -1 and 1/);
  assert.throws(() => resolveSimulationTuning({ pomposity: -1.01 }), /pomposity must be between -1 and 1/);
  assert.throws(() => resolveSimulationTuning({ worldDynamic: 1.01 }), /worldDynamic must be between -1 and 1/);
  assert.throws(() => resolveSimulationTuning({ promptHistoryLimit: 0 }), /positive integer/);
  assert.throws(() => resolveSimulationTuning({ conversationTurnLikelihoodPercent: 101 }), /between 0 and 100/);
  assert.throws(() => resolveSimulationTuning({ typicalChangesMin: 5, typicalChangesMax: 2 }), /ordered/);
  assert.throws(() => resolveSimulationTuning({ typicalConversationMinTurns: 8, typicalConversationMaxTurns: 4 }), /turn counts must be ordered/);
  assert.throws(() => resolveSimulationTuning({ conversationEndMemoryImportance: 2 }), /between 0 and 1/);
});

test("pomposity strongly favors ordinary speech by default and supports both extremes", () => {
  assert.match(pomposityInstruction(0), /contractions, short or incomplete sentences, ordinary vocabulary/);
  assert.match(pomposityInstruction(0), /average everyday speech is neither unintelligent nor inarticulate/);
  assert.match(pomposityInstruction(1), /Shakespeare-like/);
  assert.match(pomposityInstruction(-1), /slang-heavy/);
});

test("world dynamic interpolates pacing and preserves changes at the quiet endpoint", () => {
  assert.match(worldDynamicInstruction(1), /intensely hectic/);
  assert.match(worldDynamicInstruction(-1), /exceptionally quiet and still/);
  assert.match(worldDynamicInstruction(-1), /every step must still contain at least one meaningful change/);
  assert.match(worldDynamicInstruction(0.4), /70% hectic\/active behavior and 30% quiet\/still behavior/);
  const balanced = dynamicPacing(resolveSimulationTuning({ worldDynamic: 0 }));
  assert.equal(balanced.conversationStartLikelihoodPercent, 70);
  assert.deepEqual([balanced.typicalConversationMinTurns, balanced.typicalConversationMaxTurns], [4, 10]);
  const hectic = dynamicPacing(resolveSimulationTuning({ worldDynamic: 1 }));
  assert.deepEqual([hectic.typicalChangesMin, hectic.typicalChangesMax], [4, 8]);
  assert.equal(hectic.conversationStartLikelihoodPercent, 95);
  assert.deepEqual([hectic.typicalConversationMinTurns, hectic.typicalConversationMaxTurns], [1, 3]);
  const quiet = dynamicPacing(resolveSimulationTuning({ worldDynamic: -1 }));
  assert.deepEqual([quiet.typicalChangesMin, quiet.typicalChangesMax], [1, 2]);
  assert.equal(quiet.conversationStartLikelihoodPercent, 10);
  assert.equal(quiet.conversationTurnLikelihoodPercent, 30);
});

test("hectic prompt replaces balanced conversation guidance with concrete short limits", () => {
  const prompt = decisionPrompt({ state: { decisionHistory: [] } }, { worldDynamic: 1 });
  assert.match(prompt, /Usually make 4 to 8 meaningful changes/);
  assert.match(prompt, /start a conversation in about 95%/);
  assert.match(prompt, /Conversations must be brief and hectic: target 1 to 3 spoken turns total/);
  assert.match(prompt, /already has 3 spoken turns, end it in this step/);
  assert.doesNotMatch(prompt, /engaged conversations may continue longer/);
});

test("world tendency produces monotonic narrative guidance including strict endpoints", () => {
  assert.match(worldTendencyInstruction(1), /consistently happy, peaceful, cooperative, and fortunate/);
  assert.match(worldTendencyInstruction(-1), /every step go sideways/);
  assert.match(worldTendencyInstruction(0.4), /70% peaceful\/fortunate outcomes and 30% adverse\/conflict outcomes/);
  assert.match(worldTendencyInstruction(-0.4), /30% peaceful\/fortunate outcomes and 70% adverse\/conflict outcomes/);
});

test("world rules reject a facing direction unavailable at a position", () => {
  const state = setupWithoutConversation();
  const rules = new WorldRules({ scene, state: state.snapshot() });
  assert.throws(() => rules.assertValid({ summary: "Felix turns.", changes: [
    { type: ChangeType.PLACE_CHARACTER, characterId: "felix-adebayo", positionId: "chair", posture: Posture.SITTING, facing: "front" },
  ] }), /facing is not allowed/);
});

test("OpenAI provider sends the context using a structured Responses request", async () => {
  let request!: { model: string; max_output_tokens: number; text: { verbosity: string; format: { type: string } } };
  const provider = new OpenAIProvider({ apiKey: "test-key", model: "test-model", fetchImpl: async (_url, options) => {
    request = JSON.parse(options?.body as string);
    return { ok: true, status: 200, text: async () => "", json: async () => ({ output_text: '{"summary":"quiet","changes":[]}' }) };
  } });
  const result = await provider.decide({ scene, characters: profiles, state: setup().snapshot(), rules: {} });
  assert.equal(request.model, "test-model");
  assert.equal(request.max_output_tokens, 800);
  assert.equal(request.text.verbosity, "low");
  assert.equal(request.text.format.type, "json_schema");
  assert.deepEqual(result, { summary: "quiet", changes: [] });
});

test("OpenAI provider defaults to the low-latency Luna model", () => {
  const provider = new OpenAIProvider({ apiKey: "test-key", fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({ output_text: '{"summary":"quiet","changes":[]}' }),
  }) });
  assert.equal(provider.model, "gpt-5.6-luna");
});

test("OpenAI provider parses output text from the raw Responses REST payload", async () => {
  const provider = new OpenAIProvider({ apiKey: "test-key", fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      id: "resp_test",
      output: [
        { type: "reasoning", content: [] },
        { type: "message", content: [
          { type: "output_text", text: '{"summary":"quiet","changes":[]}' },
        ] },
      ],
    }),
  }) });

  assert.deepEqual(await provider.decide({}), { summary: "quiet", changes: [] });
});

test("OpenAI provider binds the default fetch implementation", async () => {
  const originalFetch = globalThis.fetch;
  const receiver = globalThis;
  globalThis.fetch = async function (this: typeof globalThis) {
    assert.equal(this, receiver);
    return new Response('{"output_text":"{\\"summary\\":\\"quiet\\",\\"changes\\":[] }"}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } as typeof fetch;

  try {
    const provider = new OpenAIProvider({ apiKey: "test-key" });
    await provider.decide({});
  } finally {
    globalThis.fetch = originalFetch;
  }
});
