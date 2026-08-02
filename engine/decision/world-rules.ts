import { ChangeType, Posture } from "../state/index.js";
import type { Scene, ScenePosition, SimulationDecision, SimulationSnapshot, SimulationState } from "../state/index.js";
import type { DecisionContext } from "./decision-context.js";

type UntrustedChange = Record<string, any>;
type FieldValidators = Record<string, (value: any) => boolean>;

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
    changes: { type: "array", maxItems: 12, items: { type: "object" } },
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
    if (decision.changes.length > 12) errors.push("A simulation step may contain at most 12 changes.");
    const speakers = new Set<string>();
    decision.changes.forEach((change: UntrustedChange, index: number) => this.#validateChange(change, index, speakers, errors));
    return errors;
  }

  assertValid(decision: any): void { const errors = this.validate(decision); if (errors.length) throw new WorldRuleViolation(errors); }

  #validateChange(change: UntrustedChange, index: number, speakers: Set<string>, errors: string[]): number | void {
    const prefix = `changes[${index}]`;
    if (!change || typeof change.type !== "string") return errors.push(`${prefix} needs a type.`);
    const character = (id: string, field = "characterId"): void => { if (!this.characterIds.has(id)) errors.push(`${prefix}.${field} is not a scene character.`); };
    const activeConversation = (id: string): boolean => Boolean(this.state.conversations[id] && !this.state.conversations[id].endedAt);
    switch (change.type) {
      case ChangeType.SAY: {
        if (!activeConversation(change.conversationId)) errors.push(`${prefix}.conversationId is not active.`);
        else if (!this.state.conversations[change.conversationId].participants.includes(change.speakerId)) errors.push(`${prefix}.speakerId is not a participant.`);
        if (!text(change.text)) errors.push(`${prefix}.text is required.`);
        const key = change.conversationId;
        if (speakers.has(key)) errors.push(`Only one character may speak in conversation ${key} during one step.`);
        speakers.add(key);
        break;
      }
      case ChangeType.REMEMBER:
        character(change.characterId);
        if (!text(change.memory?.summary)) errors.push(`${prefix}.memory.summary is required.`);
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
        const place = this.placeById.get(change.positionId);
        if (!place) errors.push(`${prefix}.positionId is not in the scene.`);
        else if (!(place.allowedPostures ?? Object.values(Posture)).includes(change.posture)) errors.push(`${prefix}.posture is not allowed at that place.`);
        else {
          const occupant = Object.entries(this.state.characters).find(([, characterState]) => characterState.positionId === change.positionId)?.[0];
          if (occupant && occupant !== change.characterId) errors.push(`${prefix}.positionId is occupied.`);
        }
        break;
      }
      case ChangeType.SET_POSTURE:
        character(change.characterId);
        if (!this.state.characters[change.characterId]?.positionId) errors.push(`${prefix} character must be placed first.`);
        break;
      case ChangeType.START_CONVERSATION:
        if (!text(change.id) || this.state.conversations[change.id]) errors.push(`${prefix}.id must be a new id.`);
        if (!Array.isArray(change.participants) || change.participants.length < 2 || new Set(change.participants).size !== change.participants.length) errors.push(`${prefix}.participants needs two unique characters.`);
        else change.participants.forEach((id: string) => character(id, "participants"));
        break;
      case ChangeType.END_CONVERSATION:
        if (!activeConversation(change.conversationId)) errors.push(`${prefix}.conversationId is not active.`);
        break;
      case ChangeType.ADD_EVENT:
        if (!text(change.event?.type) || !text(change.event?.summary)) errors.push(`${prefix}.event needs type and summary.`);
        (change.event?.participants ?? []).forEach((id: string) => character(id, "event.participants"));
        break;
      default:
        errors.push(`${prefix}.type is not an allowed change.`);
    }
  }
}

export function applyDecision(state: SimulationState, decision: SimulationDecision, rules: WorldRules) {
  rules.assertValid(decision);
  for (const change of decision.changes) {
    switch (change.type) {
      case ChangeType.SAY: state.addConversationTurn(change.conversationId, { speakerId: change.speakerId, text: change.text }); break;
      case ChangeType.REMEMBER: state.remember(change.characterId, change.memory); break;
      case ChangeType.SET_MOOD: state.setMood(change.characterId, change.mood); break;
      case ChangeType.UPDATE_RELATIONSHIP: state.updateRelationship(change.fromId, change.toId, change.relationship); break;
      case ChangeType.PLACE_CHARACTER: state.placeCharacter(change.characterId, change.positionId, change.posture); break;
      case ChangeType.SET_POSTURE: state.setPosture(change.characterId, change.posture); break;
      case ChangeType.START_CONVERSATION: state.startConversation(change); break;
      case ChangeType.END_CONVERSATION: state.endConversation(change.conversationId); break;
      case ChangeType.ADD_EVENT: state.addEvent(change.event); break;
    }
  }
  return state.snapshot();
}

export function decisionPrompt(context: DecisionContext | unknown): string {
  return [
    "Decide the next small simulation step from the complete context below.",
    "Only propose allowed changes. Keep the scene quiet: zero to a few changes is normal.",
    "For each active conversation, at most one `say` change is allowed in this step.",
    "Use only ids from the context. Memories should be brief, noteworthy summaries.",
    "CONTEXT:", JSON.stringify(context),
  ].join("\n");
}

function text(value: any): boolean { return typeof value === "string" && value.trim().length > 0; }
function unit(value: any): boolean { return Number.isFinite(value) && value >= 0 && value <= 1; }
function signed(value: any): boolean { return Number.isFinite(value) && value >= -1 && value <= 1; }
function validateFields(value: any, fields: FieldValidators, label: string, errors: string[]): number | void {
  if (!value || typeof value !== "object" || !Object.keys(value).length) return errors.push(`${label} needs at least one field.`);
  for (const [key, item] of Object.entries(value)) if (!fields[key] || !fields[key](item)) errors.push(`${label}.${key} is not allowed or out of range.`);
}
