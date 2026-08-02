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
  constructor(errors) { super(`Invalid simulation decision: ${errors.join(" ")}`); this.errors = errors; }
}

/**
 * Defines which model-proposed changes are legal in one simulation step.
 * Expand ACTIONS and validateChange together whenever the state model grows.
 */
export class WorldRules {
  constructor({ scene, state }) {
    this.scene = scene;
    this.state = state;
    this.characterIds = new Set(Object.keys(state.characters));
    this.placeById = new Map(scene.positions.map((place) => [place.id, place]));
  }

  validate(decision) {
    const errors = [];
    if (!decision || typeof decision.summary !== "string" || !Array.isArray(decision.changes)) return ["A decision needs a summary and changes array."];
    if (decision.changes.length > 12) errors.push("A simulation step may contain at most 12 changes.");
    const speakers = new Set();
    decision.changes.forEach((change, index) => this.#validateChange(change, index, speakers, errors));
    return errors;
  }

  assertValid(decision) { const errors = this.validate(decision); if (errors.length) throw new WorldRuleViolation(errors); }

  #validateChange(change, index, speakers, errors) {
    const prefix = `changes[${index}]`;
    if (!change || typeof change.type !== "string") return errors.push(`${prefix} needs a type.`);
    const character = (id, field = "characterId") => { if (!this.characterIds.has(id)) errors.push(`${prefix}.${field} is not a scene character.`); };
    const activeConversation = (id) => this.state.conversations[id] && !this.state.conversations[id].endedAt;
    switch (change.type) {
      case "say": {
        if (!activeConversation(change.conversationId)) errors.push(`${prefix}.conversationId is not active.`);
        else if (!this.state.conversations[change.conversationId].participants.includes(change.speakerId)) errors.push(`${prefix}.speakerId is not a participant.`);
        if (!text(change.text)) errors.push(`${prefix}.text is required.`);
        const key = change.conversationId;
        if (speakers.has(key)) errors.push(`Only one character may speak in conversation ${key} during one step.`);
        speakers.add(key);
        break;
      }
      case "remember":
        character(change.characterId);
        if (!text(change.memory?.summary)) errors.push(`${prefix}.memory.summary is required.`);
        break;
      case "setMood":
        character(change.characterId);
        validateFields(change.mood, { valence: signed, energy: unit, socialNeed: unit }, `${prefix}.mood`, errors);
        break;
      case "updateRelationship":
        character(change.fromId, "fromId"); character(change.toId, "toId");
        if (change.fromId === change.toId) errors.push(`${prefix} cannot target the same character.`);
        validateFields(change.relationship, { affinity: signed, trust: signed }, `${prefix}.relationship`, errors);
        break;
      case "placeCharacter": {
        character(change.characterId);
        const place = this.placeById.get(change.positionId);
        if (!place) errors.push(`${prefix}.positionId is not in the scene.`);
        else if (!place.allowedPostures.includes(change.posture)) errors.push(`${prefix}.posture is not allowed at that place.`);
        else {
          const occupant = Object.entries(this.state.characters).find(([, characterState]) => characterState.positionId === change.positionId)?.[0];
          if (occupant && occupant !== change.characterId) errors.push(`${prefix}.positionId is occupied.`);
        }
        break;
      }
      case "setPosture":
        character(change.characterId);
        if (!this.state.characters[change.characterId]?.positionId) errors.push(`${prefix} character must be placed first.`);
        break;
      case "startConversation":
        if (!text(change.id) || this.state.conversations[change.id]) errors.push(`${prefix}.id must be a new id.`);
        if (!Array.isArray(change.participants) || change.participants.length < 2 || new Set(change.participants).size !== change.participants.length) errors.push(`${prefix}.participants needs two unique characters.`);
        else change.participants.forEach((id) => character(id, "participants"));
        break;
      case "endConversation":
        if (!activeConversation(change.conversationId)) errors.push(`${prefix}.conversationId is not active.`);
        break;
      case "addEvent":
        if (!text(change.event?.type) || !text(change.event?.summary)) errors.push(`${prefix}.event needs type and summary.`);
        (change.event?.participants ?? []).forEach((id) => character(id, "event.participants"));
        break;
      default:
        errors.push(`${prefix}.type is not an allowed change.`);
    }
  }
}

export function applyDecision(state, decision, rules) {
  rules.assertValid(decision);
  for (const change of decision.changes) {
    switch (change.type) {
      case "say": state.addConversationTurn(change.conversationId, { speakerId: change.speakerId, text: change.text }); break;
      case "remember": state.remember(change.characterId, change.memory); break;
      case "setMood": state.setMood(change.characterId, change.mood); break;
      case "updateRelationship": state.updateRelationship(change.fromId, change.toId, change.relationship); break;
      case "placeCharacter": state.placeCharacter(change.characterId, change.positionId, change.posture); break;
      case "setPosture": state.setPosture(change.characterId, change.posture); break;
      case "startConversation": state.startConversation(change); break;
      case "endConversation": state.endConversation(change.conversationId); break;
      case "addEvent": state.addEvent(change.event); break;
    }
  }
  return state.snapshot();
}

export function decisionPrompt(context) {
  return [
    "Decide the next small simulation step from the complete context below.",
    "Only propose allowed changes. Keep the scene quiet: zero to a few changes is normal.",
    "For each active conversation, at most one `say` change is allowed in this step.",
    "Use only ids from the context. Memories should be brief, noteworthy summaries.",
    "CONTEXT:", JSON.stringify(context),
  ].join("\n");
}

function text(value) { return typeof value === "string" && value.trim().length > 0; }
function unit(value) { return Number.isFinite(value) && value >= 0 && value <= 1; }
function signed(value) { return Number.isFinite(value) && value >= -1 && value <= 1; }
function validateFields(value, fields, label, errors) {
  if (!value || typeof value !== "object" || !Object.keys(value).length) return errors.push(`${label} needs at least one field.`);
  for (const [key, item] of Object.entries(value)) if (!fields[key] || !fields[key](item)) errors.push(`${label}.${key} is not allowed or out of range.`);
}
