/**
 * Runtime-only, serializable state for Pixel Conversations.
 * Profiles, artwork, DOM references, and AI clients live outside this module.
 */
export const Posture = Object.freeze({
  STANDING: "standing",
  SITTING: "sitting",
  SLEEPING: "sleeping",
});

export const Activity = Object.freeze({
  IDLE: "idle",
  TALKING: "talking",
  RESTING: "resting",
});

const POSTURES = new Set(Object.values(Posture));

/**
 * A character's immediate emotional state. Add new fields here and in
 * MOOD_FIELDS below when the simulation needs another mood dimension.
 *
 * `valence` is the pleasantness of the current feeling: -1 is very unpleasant,
 * 0 is neutral, and 1 is very pleasant. `energy` and `socialNeed` range from
 * 0 (low) to 1 (high).
 */
export class Mood {
  constructor({ valence = 0, energy = 0.5, socialNeed = 0.5 } = {}) {
    this.valence = signed(valence, "mood.valence");
    this.energy = unit(energy, "mood.energy");
    this.socialNeed = unit(socialNeed, "mood.socialNeed");
  }
}

/**
 * One character's directed view of another character. Both values range from
 * -1 to 1: -1 is strongly negative, 0 is neutral, and 1 is strongly positive.
 * Add future relationship dimensions here and in RELATIONSHIP_FIELDS below.
 */
export class Relationship {
  constructor({ affinity = 0, trust = 0 } = {}) {
    this.affinity = signed(affinity, "relationship.affinity");
    this.trust = signed(trust, "relationship.trust");
  }
}

const MOOD_FIELDS = Object.freeze({ valence: signed, energy: unit, socialNeed: unit });
const RELATIONSHIP_FIELDS = Object.freeze({ affinity: signed, trust: signed });

export class SimulationState {
  #state;
  #positions;
  #memoryLimit;

  constructor({ scene, characterIds, memoryLimit = 12, startedAt = new Date().toISOString() }) {
    if (!scene?.id || !Array.isArray(scene.positions)) throw new TypeError("A scene with an id and positions is required.");
    if (!Array.isArray(characterIds) || new Set(characterIds).size !== characterIds.length) throw new TypeError("characterIds must be unique.");
    if (!Number.isInteger(memoryLimit) || memoryLimit < 1) throw new RangeError("memoryLimit must be a positive integer.");

    this.#positions = new Map(scene.positions.map((position) => [position.id, normalisePosition(position)]));
    if (this.#positions.size !== scene.positions.length || [...this.#positions.values()].some(({ id }) => !id)) throw new TypeError("Every scene position needs a unique id.");
    this.#memoryLimit = memoryLimit;
    this.#state = {
      version: 1,
      sceneId: scene.id,
      startedAt,
      elapsedMs: 0,
      paused: false,
      characters: Object.fromEntries(characterIds.map((id) => [id, newCharacterState()])),
      conversations: {},
      events: [],
    };
  }

  snapshot() { return structuredClone(this.#state); }

  tick(elapsedMs) {
    nonNegative(elapsedMs, "elapsedMs");
    if (!this.#state.paused) this.#state.elapsedMs += elapsedMs;
    return this.snapshot();
  }

  setPaused(paused) { this.#state.paused = Boolean(paused); return this.snapshot(); }

  placeCharacter(characterId, positionId, posture = Posture.STANDING) {
    const character = this.#character(characterId);
    const position = this.#position(positionId);
    assertPosture(posture);
    if (!position.allowedPostures.includes(posture)) throw new RangeError(`${posture} is not allowed at position ${positionId}.`);
    const occupants = Object.values(this.#state.characters).filter((other) => other.positionId === positionId);
    if (character.positionId !== positionId && occupants.length > 0) throw new RangeError(`Place ${positionId} is occupied.`);
    Object.assign(character, { positionId, posture, activity: posture === Posture.SLEEPING ? Activity.RESTING : Activity.IDLE });
    return this.snapshot();
  }

  setPosture(characterId, posture) {
    const character = this.#character(characterId);
    if (!character.positionId) throw new Error("Place a character before setting their posture.");
    return this.placeCharacter(characterId, character.positionId, posture);
  }

  setMood(characterId, mood) {
    const character = this.#character(characterId);
    for (const [key, validate] of Object.entries(MOOD_FIELDS)) {
      if (mood[key] !== undefined) character.mood[key] = validate(mood[key], `mood.${key}`);
    }
    return this.snapshot();
  }

  remember(characterId, memory) {
    const character = this.#character(characterId);
    if (!memory?.summary || typeof memory.summary !== "string") throw new TypeError("A memory needs a non-empty summary.");
    character.memories.push({
      summary: memory.summary,
      importance: unit(memory.importance ?? 0.5, "memory.importance"),
      tags: [...new Set(memory.tags ?? [])],
      createdAt: memory.createdAt ?? this.#now(),
    });
    if (character.memories.length > this.#memoryLimit) character.memories.splice(0, character.memories.length - this.#memoryLimit);
    return this.snapshot();
  }

  updateRelationship(fromId, toId, change) {
    if (fromId === toId) throw new RangeError("A character cannot relate to themselves.");
    const from = this.#character(fromId);
    this.#character(toId);
    const relationship = from.relationships[toId] ?? { affinity: 0, trust: 0 };
    for (const key of ["affinity", "trust"]) if (change[key] !== undefined) relationship[key] = signed(change[key], `relationship.${key}`);
    from.relationships[toId] = relationship;
    return this.snapshot();
  }

  startConversation({ id, participants, topic = null }) {
    if (!id || this.#state.conversations[id]) throw new RangeError("Conversation id must be unique.");
    if (!Array.isArray(participants) || participants.length < 2 || new Set(participants).size !== participants.length) throw new TypeError("A conversation needs at least two unique participants.");
    participants.forEach((characterId) => {
      const character = this.#character(characterId);
      if (!character.positionId) throw new Error(`Cannot start a conversation: ${characterId} has no position.`);
      if (character.activity === Activity.RESTING) throw new Error(`Cannot start a conversation: ${characterId} is resting.`);
      if (character.conversationId) throw new Error(`Cannot start a conversation: ${characterId} is already talking.`);
    });
    this.#state.conversations[id] = { id, participants: [...participants], topic, startedAt: this.#now(), turns: [] };
    participants.forEach((characterId) => Object.assign(this.#state.characters[characterId], { conversationId: id, activity: Activity.TALKING }));
    return this.snapshot();
  }

  addConversationTurn(conversationId, { speakerId, text, at = this.#now() }) {
    const conversation = this.#conversation(conversationId);
    if (!conversation.participants.includes(speakerId)) throw new RangeError("The speaker is not part of this conversation.");
    if (!text || typeof text !== "string") throw new TypeError("A turn needs non-empty text.");
    conversation.turns.push({ speakerId, text, at });
    return this.snapshot();
  }

  endConversation(conversationId) {
    const conversation = this.#conversation(conversationId);
    conversation.endedAt = this.#now();
    conversation.participants.forEach((characterId) => {
      const character = this.#state.characters[characterId];
      character.conversationId = null;
      character.activity = character.posture === Posture.SLEEPING ? Activity.RESTING : Activity.IDLE;
    });
    return this.snapshot();
  }

  addEvent({ type, summary, participants = [], at = this.#now() }) {
    if (!type || !summary) throw new TypeError("An event needs a type and summary.");
    participants.forEach((characterId) => this.#character(characterId));
    this.#state.events.push({ type, summary, participants: [...new Set(participants)], at });
    return this.snapshot();
  }

  #character(id) { const character = this.#state.characters[id]; if (!character) throw new RangeError(`Unknown character: ${id}.`); return character; }
  #position(id) { const position = this.#positions.get(id); if (!position) throw new RangeError(`Unknown position: ${id}.`); return position; }
  #conversation(id) { const conversation = this.#state.conversations[id]; if (!conversation || conversation.endedAt) throw new RangeError(`No active conversation: ${id}.`); return conversation; }
  #now() { return new Date(Date.parse(this.#state.startedAt) + this.#state.elapsedMs).toISOString(); }
}

function newCharacterState() {
  return {
    positionId: null,
    posture: Posture.STANDING,
    activity: Activity.IDLE,
    mood: { valence: 0, energy: 0.5, socialNeed: 0.5 },
    memories: [],
    relationships: {},
    conversationId: null,
  };
}

function normalisePosition(position) { return { id: position.id, capacity: position.capacity ?? 1, allowedPostures: position.allowedPostures ?? Object.values(Posture) }; }
function assertPosture(posture) { if (!POSTURES.has(posture)) throw new RangeError(`Unknown posture: ${posture}.`); }
function nonNegative(value, label) { if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative.`); }
function unit(value, label) { nonNegative(value, label); if (value > 1) throw new RangeError(`${label} must be between 0 and 1.`); return value; }
function signed(value, label) { if (!Number.isFinite(value) || value < -1 || value > 1) throw new RangeError(`${label} must be between -1 and 1.`); return value; }
