import { Activity, ChangeType, ConversationStatus, conversationArrangementError, conversationPairFacings, EmotionalState, Posture } from "../state/index.js";
import type { CharacterState, Scene, ScenePosition, SimulationChange, SimulationDecision, SimulationSnapshot, SimulationState } from "../state/index.js";

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
    const closingParticipants = new Set<string>();
    decision.changes.forEach((change: UntrustedChange, index: number) => this.#validateChange(change, index, speakers, conversations, projectedCharacters, closingParticipants, errors));
    return errors;
  }

  assertValid(decision: any): void { const errors = this.validate(decision); if (errors.length) throw new WorldRuleViolation(errors); }

  #validateChange(change: UntrustedChange, index: number, speakers: Set<string>, conversations: Map<string, ProjectedConversation>, projectedCharacters: Record<string, CharacterState>, closingParticipants: Set<string>, errors: string[]): number | void {
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
        if (closingParticipants.has(change.characterId)) errors.push(`${prefix} cannot move a character whose conversation is closing in this decision.`);
        else if (projectedCharacter?.conversationId) errors.push(`${prefix} must end the character's conversation before moving them.`);
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
          participants.forEach((id) => {
            closingParticipants.add(id);
            Object.assign(projectedCharacters[id], { conversationId: null, activity: Activity.IDLE });
          });
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

function text(value: any): boolean { return typeof value === "string" && value.trim().length > 0; }
function unit(value: any): boolean { return Number.isFinite(value) && value >= 0 && value <= 1; }
function signed(value: any): boolean { return Number.isFinite(value) && value >= -1 && value <= 1; }
function emotion(value: any): boolean { return Object.values(EmotionalState).includes(value); }
function validateFields(value: any, fields: FieldValidators, label: string, errors: string[]): number | void {
  if (!value || typeof value !== "object" || !Object.keys(value).length) return errors.push(`${label} needs at least one field.`);
  for (const [key, item] of Object.entries(value)) if (!fields[key] || !fields[key](item)) errors.push(`${label}.${key} is not allowed or out of range.`);
}
