import { Activity, ChangeType, ConversationStatus, conversationArrangementError, conversationPairFacings, EmotionalState, Posture } from "../state/index.js";
import type { CharacterState, Scene, ScenePosition, SimulationChange, SimulationDecision, SimulationSnapshot, SimulationState } from "../state/index.js";
import type { DecisionContext } from "./decision-context.js";
import { resolveSimulationTuning } from "./simulation-tuning.js";
import type { SimulationTuning } from "./simulation-tuning.js";

type UntrustedChange = Record<string, any>;
type FieldValidators = Record<string, (value: any) => boolean>;
type ProjectedConversation = { participants: string[] };
const CONVERSATION_EVENT_TYPE = /conversation|dialogue|speech|utterance|overture/i;

/**
 * The provider must return this shape. Local validation below is authoritative;
 * this schema only guarantees a parseable envelope at the provider boundary.
 */
export const DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "changes"],
  properties: {
    summary: { type: "string" },
    changes: { type: "array", minItems: 1, maxItems: 12, items: { type: "object" } },
  },
};

export class WorldRuleViolation extends Error {
  errors: string[];
  constructor(errors: string[]) { super(`Invalid simulation decision: ${errors.join(" ")}`); this.errors = errors; }
}

/**
 * Defines which model-proposed changes are legal in one simulation step.
 * Expand ACTIONS and validateChange together whenever the state model grows.
 */
export class WorldRules {
  scene: Scene;
  state: SimulationSnapshot;
  characterIds: Set<string>;
  placeById: Map<string, ScenePosition>;
  constructor({ scene, state }: { scene: Scene; state: SimulationSnapshot }) {
    this.scene = scene;
    this.state = state;
    this.characterIds = new Set(Object.keys(state.characters));
    this.placeById = new Map(scene.positions.map((place) => [place.id, place]));
  }

  validate(decision: any): string[] {
    const errors: string[] = [];
    if (!decision || typeof decision.summary !== "string" || !Array.isArray(decision.changes)) return ["A decision needs a summary and changes array."];
    if (decision.changes.length < 1) errors.push("A simulation step needs at least one change.");
    if (decision.changes.length > 12) errors.push("A simulation step may contain at most 12 changes.");
    if (decision.changes.filter((change: UntrustedChange) => change?.type === ChangeType.ADD_EVENT).length > 1) errors.push("A simulation step may add at most one event.");
    const speakers = new Set<string>();
    const projectedCharacters = structuredClone(this.state.characters);
    const conversations = new Map<string, ProjectedConversation>(
      Object.values(this.state.conversations)
        .filter((conversation) => conversation.status === ConversationStatus.ACTIVE)
        .map((conversation) => [conversation.id, { participants: conversation.participants }]),
    );
    decision.changes.forEach((change: UntrustedChange, index: number) => this.#validateChange(change, index, speakers, conversations, projectedCharacters, errors));
    return errors;
  }

  assertValid(decision: any): void { const errors = this.validate(decision); if (errors.length) throw new WorldRuleViolation(errors); }

  #validateChange(change: UntrustedChange, index: number, speakers: Set<string>, conversations: Map<string, ProjectedConversation>, projectedCharacters: Record<string, CharacterState>, errors: string[]): number | void {
    const prefix = `changes[${index}]`;
    if (!change || typeof change.type !== "string") return errors.push(`${prefix} needs a type.`);
    const character = (id: string, field = "characterId"): void => { if (!this.characterIds.has(id)) errors.push(`${prefix}.${field} is not a scene character.`); };
    const activeConversation = (id: string): boolean => conversations.has(id);
    switch (change.type) {
      case ChangeType.SAY: {
        if (!activeConversation(change.conversationId)) errors.push(`${prefix}.conversationId is not active.`);
        else if (!conversations.get(change.conversationId)!.participants.includes(change.speakerId)) errors.push(`${prefix}.speakerId is not a participant.`);
        if (!text(change.text)) errors.push(`${prefix}.text is required.`);
        const key = change.conversationId;
        if (speakers.has(key)) errors.push(`Only one character may speak in conversation ${key} during one step.`);
        speakers.add(key);
        break;
      }
      case ChangeType.REMEMBER:
        character(change.characterId);
        if (!text(change.memory?.summary)) errors.push(`${prefix}.memory.summary is required.`);
        if (change.memory?.importance !== undefined && !unit(change.memory.importance)) errors.push(`${prefix}.memory.importance must be between 0 and 1.`);
        if (change.memory && Object.keys(change.memory).some((key) => !["summary", "importance"].includes(key))) errors.push(`${prefix}.memory only allows summary and importance.`);
        break;
      case ChangeType.SET_MOOD:
        character(change.characterId);
        validateFields(change.mood, { valence: signed, energy: unit, socialNeed: unit, emotionalState: emotion }, `${prefix}.mood`, errors);
        break;
      case ChangeType.UPDATE_RELATIONSHIP:
        character(change.fromId, "fromId"); character(change.toId, "toId");
        if (change.fromId === change.toId) errors.push(`${prefix} cannot target the same character.`);
        validateFields(change.relationship, { affinity: signed, trust: signed }, `${prefix}.relationship`, errors);
        break;
      case ChangeType.PLACE_CHARACTER: {
        character(change.characterId);
        const projectedCharacter = projectedCharacters[change.characterId];
        const place = this.placeById.get(change.positionId);
        if (projectedCharacter?.conversationId) errors.push(`${prefix} must end the character's conversation before moving them.`);
        else if (!place) errors.push(`${prefix}.positionId is not in the scene.`);
        else if (!(place.allowedPostures ?? Object.values(Posture)).includes(change.posture)) errors.push(`${prefix}.posture is not allowed at that place.`);
        else if (change.facing !== undefined && !(place.allowedDirections ?? ["front", "left", "right"]).includes(change.facing)) errors.push(`${prefix}.facing is not allowed at that place.`);
        else {
          const occupant = Object.entries(projectedCharacters).find(([, characterState]) => characterState.positionId === change.positionId)?.[0];
          if (occupant && occupant !== change.characterId) errors.push(`${prefix}.positionId is occupied.`);
          else if (projectedCharacter) Object.assign(projectedCharacter, { positionId: change.positionId, posture: change.posture, facing: change.facing ?? place.allowedDirections?.[0] ?? "front", activity: Activity.IDLE });
        }
        break;
      }
      case ChangeType.SET_POSTURE:
        character(change.characterId);
        if (!projectedCharacters[change.characterId]?.positionId) errors.push(`${prefix} character must be placed first.`);
        else if (projectedCharacters[change.characterId].conversationId) errors.push(`${prefix} must end the character's conversation before changing posture.`);
        break;
      case ChangeType.SET_ACTIVITY: {
        character(change.characterId);
        const projectedCharacter = projectedCharacters[change.characterId];
        if (!projectedCharacter?.positionId) errors.push(`${prefix} character must be placed first.`);
        else if (projectedCharacter.conversationId) errors.push(`${prefix} must end the character's conversation before changing activity.`);
        else if (![Activity.IDLE, Activity.SLEEPING].includes(change.activity)) errors.push(`${prefix}.activity must be idle or sleeping; talking is managed by conversations.`);
        else if (change.activity === Activity.SLEEPING && projectedCharacter.posture !== Posture.SITTING) errors.push(`${prefix} character can sleep only while sitting.`);
        else projectedCharacter.activity = change.activity;
        break;
      }
      case ChangeType.START_CONVERSATION: {
        const validId = text(change.id) && !this.state.conversations[change.id] && !conversations.has(change.id);
        if (!validId) errors.push(`${prefix}.id must be a new id.`);
        const validParticipants = Array.isArray(change.participants) && change.participants.length === 2 && new Set(change.participants).size === change.participants.length;
        if (!validParticipants) errors.push(`${prefix}.participants needs exactly two unique characters.`);
        else change.participants.forEach((id: string) => character(id, "participants"));
        if (validId && validParticipants && change.participants.every((id: string) => this.characterIds.has(id))) {
          const unavailable = change.participants.find((id: string) => projectedCharacters[id].activity === Activity.SLEEPING || projectedCharacters[id].conversationId);
          const arrangementError = conversationArrangementError(this.scene, projectedCharacters, change.participants);
          if (unavailable) errors.push(`${prefix}: ${unavailable} is sleeping or already in a conversation.`);
          else if (arrangementError) errors.push(`${prefix}: ${arrangementError}`);
          else {
            const facings = conversationPairFacings(this.scene, projectedCharacters, change.participants)!;
            conversations.set(change.id, { participants: [...change.participants] });
            change.participants.forEach((id: string, participantIndex: number) => Object.assign(projectedCharacters[id], { conversationId: change.id, activity: Activity.TALKING, facing: facings[participantIndex] }));
          }
        }
        break;
      }
      case ChangeType.END_CONVERSATION:
        if (!activeConversation(change.conversationId)) errors.push(`${prefix}.conversationId is not active.`);
        else {
          const participants = conversations.get(change.conversationId)!.participants;
          conversations.delete(change.conversationId);
          participants.forEach((id) => Object.assign(projectedCharacters[id], { conversationId: null, activity: Activity.IDLE }));
        }
        break;
      case ChangeType.PAUSE_CONVERSATION:
        if (!activeConversation(change.conversationId)) errors.push(`${prefix}.conversationId is not active.`);
        if (speakers.has(change.conversationId)) errors.push(`Only one spoken or listening beat is allowed in conversation ${change.conversationId} during one step.`);
        speakers.add(change.conversationId);
        break;
      case ChangeType.ADD_EVENT:
        if (!text(change.event?.type) || !text(change.event?.summary)) errors.push(`${prefix}.event needs type and summary.`);
        else if (CONVERSATION_EVENT_TYPE.test(change.event.type)) errors.push(`${prefix}.event.type cannot represent speech or conversation lifecycle; use startConversation, say, or endConversation.`);
        (change.event?.participants ?? []).forEach((id: string) => character(id, "event.participants"));
        break;
      default:
        errors.push(`${prefix}.type is not an allowed change.`);
    }
  }
}

export function applyDecision(state: SimulationState, decision: SimulationDecision, rules: WorldRules) {
  rules.assertValid(decision);
  for (const change of decision.changes) applyChange(state, change);
  state.recordDecision(decision.summary);
  return state.snapshot();
}

export function applyChange(state: SimulationState, change: SimulationChange): void {
  switch (change.type) {
    case ChangeType.SAY: state.addConversationTurn(change.conversationId, { speakerId: change.speakerId, text: change.text }); break;
    case ChangeType.REMEMBER: state.remember(change.characterId, change.memory); break;
    case ChangeType.SET_MOOD: state.setMood(change.characterId, change.mood); break;
    case ChangeType.UPDATE_RELATIONSHIP: state.updateRelationship(change.fromId, change.toId, change.relationship); break;
    case ChangeType.PLACE_CHARACTER: state.placeCharacter(change.characterId, change.positionId, change.posture, change.facing); break;
    case ChangeType.SET_POSTURE: state.setPosture(change.characterId, change.posture); break;
    case ChangeType.SET_ACTIVITY: state.setActivity(change.characterId, change.activity); break;
    case ChangeType.START_CONVERSATION: state.startConversation(change); break;
    case ChangeType.END_CONVERSATION: state.endConversation(change.conversationId); break;
    case ChangeType.PAUSE_CONVERSATION: state.pauseConversation(change.conversationId); break;
    case ChangeType.ADD_EVENT: state.addEvent(change.event); break;
  }
}

export function decisionPrompt(context: DecisionContext | unknown, overrides: Partial<SimulationTuning> = {}): string {
  const tuning = resolveSimulationTuning(overrides);
  const pacing = dynamicPacing(tuning);
  const history = (context as any)?.state?.decisionHistory;
  const recentHistory = Array.isArray(history) ? history.slice(-tuning.promptHistoryLimit) : [];
  const promptContext = structuredClone(context as any);
  if (promptContext?.state && Array.isArray(promptContext.state.decisionHistory)) {
    promptContext.state.decisionHistory = recentHistory;
  }
  return [
    "Decide the next small simulation step from the complete context below.",
    worldTendencyInstruction(tuning.worldTendency),
    pomposityInstruction(tuning.pomposity),
    worldDynamicInstruction(tuning.worldDynamic),
    `Only propose allowed changes. Usually make ${pacing.typicalChangesMin} to ${pacing.typicalChangesMax} meaningful changes. Zero changes are not allowed.`,
    dynamicPriorityInstruction(tuning.worldDynamic),
    `When at least two placed, awake characters are available and no conversation is active, aim to start a conversation in about ${pacing.conversationStartLikelihoodPercent}% of eligible steps.`,
    "Choose conversational participation primarily from each participant's full profile, personality, conversational style, current mood, social need, relationships, and the recent conversation beats.",
    "Do not alternate speakers mechanically. A shy, guarded, tired, or uncomfortable character may mostly listen; an outgoing, excited, confident, or verbose character may speak repeatedly or temporarily dominate.",
    "Personality creates tendencies, not absolute restrictions. Topic, trust, mood, unanswered questions, and what was just said may change who speaks.",
    "Use mood.emotionalState to capture the character's concrete visible emotion. The only allowed values are happy, sad, angry, and neutral. Decide autonomously when it should change; do not change it mechanically every step.",
    "Emotional-state examples: kind or affirming words, success, connection, or an enjoyable exchange may trigger happy; hurtful words, disappointment, loss, rejection, or going without social contact for a while may trigger sad; insults, betrayal, unfair treatment, provocation, or a frustrating remark may trigger angry; use neutral when no distinct emotion dominates or after a feeling has naturally settled.",
    "Keep the continuous valence, energy, and socialNeed mood dimensions meaningful alongside emotionalState; emotionalState is not a replacement for them.",
    "Posture is only standing or sitting. Sleeping is an activity, never a posture, and setActivity may select sleeping only for a seated character. Talking activity is managed by conversation actions.",
    `Only when character evidence is weak, use these fallback tendencies: speech in about ${pacing.conversationTurnLikelihoodPercent}% of active-conversation steps, a listening pause in about ${pacing.defaultListeningPauseLikelihoodPercent}%, and the same speaker continuing in about ${pacing.defaultSameSpeakerContinuationLikelihoodPercent}%.`,
    conversationLengthInstruction(pacing, tuning.worldDynamic),
    "Conversation lifecycle is explicit: startConversation creates it, say records exact spoken words, and endConversation marks it closing. A closing conversation accepts no more speech and is deleted automatically before the next simulation step. addEvent must never substitute for any of these.",
    "Use addEvent, in addition to any other necessary changes, when a meaningful non-dialogue occurrence is important to understanding the world. At most one event may be added per step; it remains visible for the resulting frame and expires before the next simulation step.",
    "Physical connection is mandatory before speech. Before startConversation, both participants must occupy one of context.scene.conversationPairs. Starting the conversation automatically turns them to the pair's listed facings so they look toward each other. Return placeCharacter changes first only when their positions do not already form a pair.",
    "To open a conversation, arrange both people if necessary, then return startConversation followed later in the same changes array by one say using conversationId equal to startConversation.id.",
    'Opening example: [{"type":"placeCharacter","characterId":"felix-adebayo","positionId":"chair-2/seat","posture":"sitting","facing":"right"},{"type":"placeCharacter","characterId":"grace-kim","positionId":"floor-center","posture":"standing","facing":"left"},{"type":"startConversation","id":"cafe-chat","participants":["grace-kim","felix-adebayo"],"topic":"amateur astronomy"},{"type":"say","conversationId":"cafe-chat","speakerId":"grace-kim","text":"What first drew you to amateur astronomy?"}]',
    'To continue it later: {"type":"say","conversationId":"cafe-chat","speakerId":"felix-adebayo","text":"I started by learning the winter constellations."}',
    'For a listening beat with no spoken words: {"type":"pauseConversation","conversationId":"cafe-chat"}',
    'To close it: {"type":"endConversation","conversationId":"cafe-chat"}',
    "Follow the action field contracts and position affordances in context.rules exactly. Every change uses `type`, never `action`.",
    "For each active conversation, at most one `say` change is allowed in this step.",
    `Memory is rare. When a conversation ends, create one concise remember action for each participant in about ${tuning.conversationEndMemoryLikelihoodPercent}% of cases, normally with importance ${tuning.conversationEndMemoryImportance}.`,
    `Outside conversation endings, create a memory only for an extraordinary event or sentence (roughly ${tuning.extraordinaryMemoryLikelihoodPercent}% of eligible moments), with importance at least ${tuning.extraordinaryMemoryMinimumImportance}. Memories contain only summary and importance.`,
    "Use only ids from the context.",
    "CONTEXT:", JSON.stringify(promptContext),
    "RECENT WORLD CHANGE SUMMARIES (oldest to newest):", JSON.stringify(recentHistory),
  ].join("\n");
}

function text(value: any): boolean { return typeof value === "string" && value.trim().length > 0; }
function unit(value: any): boolean { return Number.isFinite(value) && value >= 0 && value <= 1; }
function signed(value: any): boolean { return Number.isFinite(value) && value >= -1 && value <= 1; }
function emotion(value: any): boolean { return Object.values(EmotionalState).includes(value); }
export function worldTendencyInstruction(tendency: number): string {
  const positiveBiasPercent = Math.round((tendency + 1) * 50);
  const adverseBiasPercent = 100 - positiveBiasPercent;
  const value = tendency > 0 ? `+${tendency}` : String(tendency);
  if (tendency === 1) return "WORLD TENDENCY +1: Keep outcomes consistently happy, peaceful, cooperative, and fortunate. Do not introduce disasters, hostility, or conflict.";
  if (tendency === -1) return "WORLD TENDENCY -1: Make every step go sideways through conflict, hostility, misfortune, danger, or meaningful setbacks. Peaceful resolutions should not arise.";
  if (tendency === 0) return "WORLD TENDENCY 0: Keep outcomes balanced and causally plausible; allow warmth, conflict, good fortune, and setbacks according to the characters and current situation without favoring either direction.";
  return `WORLD TENDENCY ${value}: Use this as a narrative prior of approximately ${positiveBiasPercent}% peaceful/fortunate outcomes and ${adverseBiasPercent}% adverse/conflict outcomes. Preserve character causality and choose the next event with this directional bias.`;
}
export function pomposityInstruction(pomposity: number): string {
  const value = pomposity > 0 ? `+${pomposity}` : String(pomposity);
  if (pomposity === 1) return "DIALOGUE POMPOSITY +1: Make spoken dialogue deliberately grand, ornate, theatrical, and Shakespeare-like. Favor elaborate metaphors, formal constructions, heightened rhetoric, and unusually sophisticated vocabulary.";
  if (pomposity === -1) return "DIALOGUE POMPOSITY -1: Make spoken dialogue extremely casual and slang-heavy, using fragments, clipped wording, fillers, and deliberately nonstandard grammar. Keep the meaning understandable and preserve each character's identity.";
  const ornatePercent = Math.round((pomposity + 1) * 50);
  const everydayPercent = 100 - Math.abs(Math.round(pomposity * 100));
  return `DIALOGUE POMPOSITY ${value}: IMPORTANT—write dialogue that sounds spoken by real people, not literary narration. Use contractions, short or incomplete sentences, ordinary vocabulary, occasional hesitation, interruptions, direct replies, and naturally uneven turn lengths. Avoid poetic imagery, polished monologues, aphorisms, theatrical declarations, and characters constantly sounding profound unless their profile and the immediate moment specifically justify it. Match vocabulary and verbal fluency to each character's background, education, personality, and current emotion; average everyday speech is neither unintelligent nor inarticulate. Apply approximately ${ornatePercent}% of the path from slang-heavy speech to ornate speech, while retaining about ${everydayPercent}% everyday conversational naturalness.`;
}
export function worldDynamicInstruction(worldDynamic: number): string {
  const value = worldDynamic > 0 ? `+${worldDynamic}` : String(worldDynamic);
  if (worldDynamic === 1) return "WORLD DYNAMIC +1: Keep the world intensely hectic. Characters move often, conversations start and stop quickly, turns are urgent and interruptible, activities change rapidly, and each step should create conspicuous momentum while obeying world rules. Do not sustain long or deeply reflective conversations.";
  if (worldDynamic === -1) return "WORLD DYNAMIC -1: Keep the world exceptionally quiet and still. Characters rarely speak or move from their chosen positions. Prefer pauses, listening, small mood shifts, or occasional posture/activity changes, but every step must still contain at least one meaningful change so the world remains alive.";
  const hecticBiasPercent = Math.round((worldDynamic + 1) * 50);
  const quietBiasPercent = 100 - hecticBiasPercent;
  return `WORLD DYNAMIC ${value}: Use a pacing prior of approximately ${hecticBiasPercent}% hectic/active behavior and ${quietBiasPercent}% quiet/still behavior. Higher values favor movement, rapid activity changes, interruptions, and shorter conversations; lower values favor staying in place, silence, listening, and subtle changes. Every step still needs a meaningful change.`;
}
export interface DynamicPacing {
  typicalChangesMin: number;
  typicalChangesMax: number;
  conversationStartLikelihoodPercent: number;
  conversationTurnLikelihoodPercent: number;
  typicalConversationMinTurns: number;
  typicalConversationMaxTurns: number;
  defaultListeningPauseLikelihoodPercent: number;
  defaultSameSpeakerContinuationLikelihoodPercent: number;
}
export function dynamicPacing(tuning: SimulationTuning): DynamicPacing {
  const amount = Math.abs(tuning.worldDynamic);
  const hectic = tuning.worldDynamic > 0;
  return {
    typicalChangesMin: interpolate(tuning.typicalChangesMin, hectic ? 4 : 1, amount),
    typicalChangesMax: interpolate(tuning.typicalChangesMax, hectic ? 8 : 2, amount),
    conversationStartLikelihoodPercent: interpolate(tuning.conversationStartLikelihoodPercent, hectic ? 95 : 10, amount),
    conversationTurnLikelihoodPercent: interpolate(tuning.conversationTurnLikelihoodPercent, hectic ? 95 : 30, amount),
    typicalConversationMinTurns: interpolate(tuning.typicalConversationMinTurns, 1, amount),
    typicalConversationMaxTurns: interpolate(tuning.typicalConversationMaxTurns, 3, amount),
    defaultListeningPauseLikelihoodPercent: interpolate(tuning.defaultListeningPauseLikelihoodPercent, hectic ? 5 : 60, amount),
    defaultSameSpeakerContinuationLikelihoodPercent: interpolate(tuning.defaultSameSpeakerContinuationLikelihoodPercent, hectic ? 20 : 15, amount),
  };
}
function dynamicPriorityInstruction(worldDynamic: number): string {
  if (worldDynamic === 1) return "Prioritize visible movement, activity changes, interruptions, conversation endings, and new situations over sustained social interaction or reflective dialogue.";
  if (worldDynamic === -1) return "Prioritize stillness, silence, listening, and subtle state changes. Avoid moving characters or starting conversations unless strongly justified.";
  if (worldDynamic > 0) return "As worldDynamic is positive, increasingly prefer movement, activity changes, interruptions, and conversation turnover over sustained dialogue.";
  if (worldDynamic < 0) return "As worldDynamic is negative, increasingly prefer stillness, silence, listening, and subtle changes over movement or conversation.";
  return "Balance social interaction, movement, stillness, and narrative progression according to character evidence.";
}
function conversationLengthInstruction(pacing: DynamicPacing, worldDynamic: number): string {
  if (worldDynamic === 1) return `Conversations must be brief and hectic: target ${pacing.typicalConversationMinTurns} to ${pacing.typicalConversationMaxTurns} spoken turns total. If an active conversation already has ${pacing.typicalConversationMaxTurns} spoken turns, end it in this step instead of continuing it, then favor movement or another activity.`;
  if (worldDynamic > 0) return `Conversations should typically contain ${pacing.typicalConversationMinTurns} to ${pacing.typicalConversationMaxTurns} spoken turns total. Positive worldDynamic means engagement must not override the pressure to interrupt or end conversations and move on.`;
  return `Conversations typically contain ${pacing.typicalConversationMinTurns} to ${pacing.typicalConversationMaxTurns} spoken turns. Treat this as a soft range, while respecting the quiet-world preference against frequent speech.`;
}
function interpolate(from: number, to: number, amount: number): number { return Math.round(from + (to - from) * amount); }
function validateFields(value: any, fields: FieldValidators, label: string, errors: string[]): number | void {
  if (!value || typeof value !== "object" || !Object.keys(value).length) return errors.push(`${label} needs at least one field.`);
  for (const [key, item] of Object.entries(value)) if (!fields[key] || !fields[key](item)) errors.push(`${label}.${key} is not allowed or out of range.`);
}
