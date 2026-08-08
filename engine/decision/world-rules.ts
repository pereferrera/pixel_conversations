import { ChangeType, conversationArrangementError, Posture } from "../state/index.js";
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
    const speakers = new Set<string>();
    const projectedCharacters = structuredClone(this.state.characters);
    const conversations = new Map<string, ProjectedConversation>(
      Object.values(this.state.conversations)
        .filter((conversation) => conversation.active)
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
        validateFields(change.mood, { valence: signed, energy: unit, socialNeed: unit }, `${prefix}.mood`, errors);
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
          else if (projectedCharacter) Object.assign(projectedCharacter, { positionId: change.positionId, posture: change.posture, facing: change.facing ?? place.allowedDirections?.[0] ?? "front" });
        }
        break;
      }
      case ChangeType.SET_POSTURE:
        character(change.characterId);
        if (!projectedCharacters[change.characterId]?.positionId) errors.push(`${prefix} character must be placed first.`);
        else if (projectedCharacters[change.characterId].conversationId) errors.push(`${prefix} must end the character's conversation before changing posture.`);
        break;
      case ChangeType.START_CONVERSATION: {
        const validId = text(change.id) && !this.state.conversations[change.id] && !conversations.has(change.id);
        if (!validId) errors.push(`${prefix}.id must be a new id.`);
        const validParticipants = Array.isArray(change.participants) && change.participants.length === 2 && new Set(change.participants).size === change.participants.length;
        if (!validParticipants) errors.push(`${prefix}.participants needs exactly two unique characters.`);
        else change.participants.forEach((id: string) => character(id, "participants"));
        if (validId && validParticipants && change.participants.every((id: string) => this.characterIds.has(id))) {
          const arrangementError = conversationArrangementError(this.scene, projectedCharacters, change.participants);
          if (arrangementError) errors.push(`${prefix}: ${arrangementError}`);
          else {
            conversations.set(change.id, { participants: [...change.participants] });
            change.participants.forEach((id: string) => { projectedCharacters[id].conversationId = change.id; });
          }
        }
        break;
      }
      case ChangeType.END_CONVERSATION:
        if (!activeConversation(change.conversationId)) errors.push(`${prefix}.conversationId is not active.`);
        else {
          const participants = conversations.get(change.conversationId)!.participants;
          conversations.delete(change.conversationId);
          participants.forEach((id) => { projectedCharacters[id].conversationId = null; });
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
    case ChangeType.START_CONVERSATION: state.startConversation(change); break;
    case ChangeType.END_CONVERSATION: state.endConversation(change.conversationId); break;
    case ChangeType.PAUSE_CONVERSATION: state.pauseConversation(change.conversationId); break;
    case ChangeType.ADD_EVENT: state.addEvent(change.event); break;
  }
}

export function decisionPrompt(context: DecisionContext | unknown, overrides: Partial<SimulationTuning> = {}): string {
  const tuning = resolveSimulationTuning(overrides);
  const history = (context as any)?.state?.decisionHistory;
  const recentHistory = Array.isArray(history) ? history.slice(-tuning.promptHistoryLimit) : [];
  const promptContext = structuredClone(context as any);
  if (promptContext?.state && Array.isArray(promptContext.state.decisionHistory)) {
    promptContext.state.decisionHistory = recentHistory;
  }
  return [
    "Decide the next small simulation step from the complete context below.",
    `Only propose allowed changes. Usually make ${tuning.typicalChangesMin} to ${tuning.typicalChangesMax} meaningful changes. Zero changes are not allowed.`,
    "Prefer social interaction and narrative progression over repeated movement, posture, or mood-only steps.",
    `When at least two placed, non-resting characters are available and no conversation is active, aim to start a conversation in about ${tuning.conversationStartLikelihoodPercent}% of eligible steps.`,
    "Choose conversational participation primarily from each participant's full profile, personality, conversational style, current mood, social need, relationships, and the recent conversation beats.",
    "Do not alternate speakers mechanically. A shy, guarded, tired, or uncomfortable character may mostly listen; an outgoing, excited, confident, or verbose character may speak repeatedly or temporarily dominate.",
    "Personality creates tendencies, not absolute restrictions. Topic, trust, mood, unanswered questions, and what was just said may change who speaks.",
    `Only when character evidence is weak, use these fallback tendencies: speech in about ${tuning.conversationTurnLikelihoodPercent}% of active-conversation steps, a listening pause in about ${tuning.defaultListeningPauseLikelihoodPercent}%, and the same speaker continuing in about ${tuning.defaultSameSpeakerContinuationLikelihoodPercent}%.`,
    `Conversations typically contain ${tuning.typicalConversationMinTurns} to ${tuning.typicalConversationMaxTurns} spoken turns. Treat this as a soft range: awkward conversations may end earlier and engaged conversations may continue longer.`,
    "Conversation lifecycle is explicit: startConversation creates it, say records exact spoken words, and endConversation closes it. addEvent must never substitute for any of these.",
    "Physical connection is mandatory before speech. Before startConversation, both participants must occupy one of context.scene.conversationPairs and use the exact facing associated with their position so they look toward each other. Return placeCharacter changes first when they are not already arranged.",
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
function validateFields(value: any, fields: FieldValidators, label: string, errors: string[]): number | void {
  if (!value || typeof value !== "object" || !Object.keys(value).length) return errors.push(`${label} needs at least one field.`);
  for (const [key, item] of Object.entries(value)) if (!fields[key] || !fields[key](item)) errors.push(`${label}.${key} is not allowed or out of range.`);
}
