/**
 * Runtime-only, serializable state for Pixel Conversations.
 * Profiles, artwork, DOM references, and AI clients live outside this module.
 */
import { DEFAULT_SIMULATION_TUNING } from "../decision/simulation-tuning.js";

export const Posture = Object.freeze({
  STANDING: "standing",
  SITTING: "sitting",
});

export const Activity = Object.freeze({
  IDLE: "idle",
  TALKING: "talking",
  SLEEPING: "sleeping",
});

export enum EmotionalState {
  HAPPY = "happy",
  SAD = "sad",
  ANGRY = "angry",
  NEUTRAL = "neutral",
}

export enum ConversationStatus {
  ACTIVE = "active",
  CLOSING = "closing",
}

export enum ChangeType {
  SAY = "say",
  REMEMBER = "remember",
  SET_MOOD = "setMood",
  UPDATE_RELATIONSHIP = "updateRelationship",
  PLACE_CHARACTER = "placeCharacter",
  SET_POSTURE = "setPosture",
  SET_ACTIVITY = "setActivity",
  START_CONVERSATION = "startConversation",
  END_CONVERSATION = "endConversation",
  PAUSE_CONVERSATION = "pauseConversation",
  ADD_EVENT = "addEvent",
}

export type PostureValue = (typeof Posture)[keyof typeof Posture];
export type ActivityValue = (typeof Activity)[keyof typeof Activity];
export type FacingDirection = "front" | "left" | "right";
export type MoodChange = Partial<{ valence: number; energy: number; socialNeed: number; emotionalState: EmotionalState }>;
export type RelationshipChange = Partial<{ affinity: number; trust: number }>;
export interface MemoryInput { summary: string; importance?: number }
export interface EventInput { type: string; summary: string; participants?: string[] }
export interface WorldEvent { type: string; summary: string; participants: string[] }
export interface ScenePosition {
  id: string;
  label?: string;
  kind?: "standing" | "seat";
  capacity?: number;
  allowedPostures?: PostureValue[];
  allowedDirections?: FacingDirection[];
  renderer?:
    | { kind: "standing"; baseline: { x: number; y: number } }
    | { kind: "seat"; elementInstanceId: string; seatId: string };
}
export interface ConversationPair {
  positions: [string, string];
  facings: [FacingDirection, FacingDirection];
}
export interface Scene { id: string; positions: ScenePosition[]; conversationPairs: ConversationPair[] }
export interface CharacterProfile { id: string; [key: string]: unknown }
export interface SimulationStateOptions { scene: Scene; characterIds: string[]; memoryLimit?: number }

export type SimulationChange =
  | { type: ChangeType.SAY; conversationId: string; speakerId: string; text: string }
  | { type: ChangeType.REMEMBER; characterId: string; memory: MemoryInput }
  | { type: ChangeType.SET_MOOD; characterId: string; mood: MoodChange }
  | { type: ChangeType.UPDATE_RELATIONSHIP; fromId: string; toId: string; relationship: RelationshipChange }
  | { type: ChangeType.PLACE_CHARACTER; characterId: string; positionId: string; posture: PostureValue; facing?: FacingDirection }
  | { type: ChangeType.SET_POSTURE; characterId: string; posture: PostureValue }
  | { type: ChangeType.SET_ACTIVITY; characterId: string; activity: ActivityValue }
  | { type: ChangeType.START_CONVERSATION; id: string; participants: string[]; topic?: string | null }
  | { type: ChangeType.END_CONVERSATION; conversationId: string }
  | { type: ChangeType.PAUSE_CONVERSATION; conversationId: string }
  | { type: ChangeType.ADD_EVENT; event: EventInput };

export interface SimulationDecision { summary: string; changes: SimulationChange[] }
export interface Memory { summary: string; importance: number }
export interface RelationshipValue { affinity: number; trust: number }
export interface CharacterState {
  positionId: string | null;
  posture: PostureValue;
  facing: FacingDirection;
  activity: ActivityValue;
  mood: { valence: number; energy: number; socialNeed: number; emotionalState: EmotionalState };
  memories: Memory[];
  relationships: Record<string, RelationshipValue>;
  conversationId: string | null;
}
export interface Conversation {
  id: string; status: ConversationStatus; participants: string[]; topic: string | null;
  beats: ConversationBeat[];
}
export type ConversationBeat =
  | { type: "say"; speakerId: string; text: string }
  | { type: "pause" };
export interface SimulationSnapshot {
  version: number; sceneId: string;
  decisionHistory: string[];
  characters: Record<string, CharacterState>;
  conversations: Record<string, Conversation>;
  event: WorldEvent | null;
}
interface NormalisedPosition { id: string; capacity: number; allowedPostures: PostureValue[]; allowedDirections: FacingDirection[] }

/** Links every decision change directly to its state mutation method. */
export const CHANGE_STATE_METHOD = Object.freeze({
  [ChangeType.SAY]: "addConversationTurn",
  [ChangeType.REMEMBER]: "remember",
  [ChangeType.SET_MOOD]: "setMood",
  [ChangeType.UPDATE_RELATIONSHIP]: "updateRelationship",
  [ChangeType.PLACE_CHARACTER]: "placeCharacter",
  [ChangeType.SET_POSTURE]: "setPosture",
  [ChangeType.SET_ACTIVITY]: "setActivity",
  [ChangeType.START_CONVERSATION]: "startConversation",
  [ChangeType.END_CONVERSATION]: "endConversation",
  [ChangeType.PAUSE_CONVERSATION]: "pauseConversation",
  [ChangeType.ADD_EVENT]: "addEvent",
} satisfies Record<ChangeType, keyof SimulationState>);

const POSTURES = new Set(Object.values(Posture));
const ACTIVITIES = new Set(Object.values(Activity));
const EMOTIONAL_STATES = new Set(Object.values(EmotionalState));
const FACING_DIRECTIONS = new Set<FacingDirection>(["front", "left", "right"]);

/**
 * A character's immediate emotional state. Add new fields here and in
 * MOOD_FIELDS below when the simulation needs another mood dimension.
 *
 * `valence` is the pleasantness of the current feeling: -1 is very unpleasant,
 * 0 is neutral, and 1 is very pleasant. `energy` and `socialNeed` range from
 * 0 (low) to 1 (high).
 */
export class Mood {
  valence: number;
  energy: number;
  socialNeed: number;
  emotionalState: EmotionalState;
  constructor({ valence = 0, energy = 0.5, socialNeed = 0.5, emotionalState = EmotionalState.NEUTRAL }: MoodChange = {}) {
    this.valence = signed(valence, "mood.valence");
    this.energy = unit(energy, "mood.energy");
    this.socialNeed = unit(socialNeed, "mood.socialNeed");
    this.emotionalState = emotion(emotionalState, "mood.emotionalState");
  }
}

/**
 * One character's directed view of another character. Both values range from
 * -1 to 1: -1 is strongly negative, 0 is neutral, and 1 is strongly positive.
 * Add future relationship dimensions here and in RELATIONSHIP_FIELDS below.
 */
export class Relationship {
  affinity: number;
  trust: number;
  constructor({ affinity = 0, trust = 0 }: RelationshipChange = {}) {
    this.affinity = signed(affinity, "relationship.affinity");
    this.trust = signed(trust, "relationship.trust");
  }
}

const MOOD_FIELDS = Object.freeze({ valence: signed, energy: unit, socialNeed: unit, emotionalState: emotion });
const RELATIONSHIP_FIELDS = Object.freeze({ affinity: signed, trust: signed });

export class SimulationState {
  #state: SimulationSnapshot;
  #scene: Scene;
  #positions: Map<string, NormalisedPosition>;
  #memoryLimit: number;

  constructor({ scene, characterIds, memoryLimit = DEFAULT_SIMULATION_TUNING.memoryLimitPerCharacter }: SimulationStateOptions) {
    if (!scene?.id || !Array.isArray(scene.positions) || !Array.isArray(scene.conversationPairs)) throw new TypeError("A scene with an id, positions, and conversationPairs is required.");
    if (!Array.isArray(characterIds) || new Set(characterIds).size !== characterIds.length) throw new TypeError("characterIds must be unique.");
    if (!Number.isInteger(memoryLimit) || memoryLimit < 1) throw new RangeError("memoryLimit must be a positive integer.");

    this.#positions = new Map(scene.positions.map((position) => [position.id, normalisePosition(position)]));
    if (this.#positions.size !== scene.positions.length || [...this.#positions.values()].some(({ id }) => !id)) throw new TypeError("Every scene position needs a unique id.");
    for (const pair of scene.conversationPairs) {
      if (pair.positions.length !== 2 || pair.facings.length !== 2 || pair.positions.some((id) => !this.#positions.has(id))) throw new TypeError("Every conversation pair needs two known positions and two facings.");
      pair.facings.forEach(assertFacing);
    }
    this.#scene = structuredClone(scene);
    this.#memoryLimit = memoryLimit;
    this.#state = {
      version: 1,
      sceneId: scene.id,
      decisionHistory: [],
      characters: Object.fromEntries(characterIds.map((id) => [id, newCharacterState()])),
      conversations: {},
      event: null,
    };
  }

  snapshot(): SimulationSnapshot { return structuredClone(this.#state); }

  recordDecision(summary: string) {
    if (typeof summary !== "string" || !summary.trim()) throw new TypeError("A decision history entry needs a non-empty summary.");
    this.#state.decisionHistory.push(summary.trim());
    return this.snapshot();
  }

  placeCharacter(characterId: string, positionId: string, posture: PostureValue = Posture.STANDING, facing?: FacingDirection) {
    const character = this.#character(characterId);
    if (character.conversationId) throw new Error(`End conversation ${character.conversationId} before moving ${characterId}.`);
    const position = this.#position(positionId);
    assertPosture(posture);
    if (!position.allowedPostures.includes(posture)) throw new RangeError(`${posture} is not allowed at position ${positionId}.`);
    const resolvedFacing = facing ?? position.allowedDirections[0];
    assertFacing(resolvedFacing);
    if (!position.allowedDirections.includes(resolvedFacing)) throw new RangeError(`${resolvedFacing} is not allowed at position ${positionId}.`);
    const occupants = Object.values(this.#state.characters).filter((other) => other.positionId === positionId);
    if (character.positionId !== positionId && occupants.length > 0) throw new RangeError(`Place ${positionId} is occupied.`);
    Object.assign(character, { positionId, posture, facing: resolvedFacing, activity: Activity.IDLE });
    return this.snapshot();
  }

  setPosture(characterId: string, posture: PostureValue) {
    const character = this.#character(characterId);
    if (!character.positionId) throw new Error("Place a character before setting their posture.");
    return this.placeCharacter(characterId, character.positionId, posture, character.facing);
  }

  setActivity(characterId: string, activity: ActivityValue) {
    const character = this.#character(characterId);
    if (!character.positionId) throw new Error("Place a character before setting their activity.");
    if (!ACTIVITIES.has(activity)) throw new RangeError(`Unknown activity: ${activity}.`);
    if (activity === Activity.TALKING) throw new RangeError("Talking activity is managed by conversation lifecycle actions.");
    if (character.conversationId) throw new Error(`End conversation ${character.conversationId} before changing ${characterId}'s activity.`);
    if (activity === Activity.SLEEPING && character.posture !== Posture.SITTING) throw new RangeError("A character can sleep only while sitting.");
    character.activity = activity;
    return this.snapshot();
  }

  setMood(characterId: string, mood: MoodChange) {
    const character = this.#character(characterId);
    for (const [key, validate] of Object.entries(MOOD_FIELDS) as Array<[keyof MoodChange, (value: any, label: string) => any]>) {
      if (mood[key] !== undefined) (character.mood as any)[key] = validate(mood[key], `mood.${key}`);
    }
    return this.snapshot();
  }

  remember(characterId: string, memory: MemoryInput) {
    const character = this.#character(characterId);
    if (!memory?.summary || typeof memory.summary !== "string") throw new TypeError("A memory needs a non-empty summary.");
    character.memories.push({
      summary: memory.summary,
      importance: unit(memory.importance ?? 0.5, "memory.importance"),
    });
    if (character.memories.length > this.#memoryLimit) {
      let leastImportantIndex = 0;
      for (let index = 1; index < character.memories.length; index += 1) {
        if (character.memories[index].importance < character.memories[leastImportantIndex].importance) leastImportantIndex = index;
      }
      character.memories.splice(leastImportantIndex, 1);
    }
    return this.snapshot();
  }

  updateRelationship(fromId: string, toId: string, change: RelationshipChange) {
    if (fromId === toId) throw new RangeError("A character cannot relate to themselves.");
    const from = this.#character(fromId);
    this.#character(toId);
    const relationship = from.relationships[toId] ?? { affinity: 0, trust: 0 };
    for (const key of ["affinity", "trust"] as const) if (change[key] !== undefined) relationship[key] = signed(change[key], `relationship.${key}`);
    from.relationships[toId] = relationship;
    return this.snapshot();
  }

  startConversation({ id, participants, topic = null }: { id: string; participants: string[]; topic?: string | null }) {
    if (!id || this.#state.conversations[id]) throw new RangeError("Conversation id must be unique.");
    if (!Array.isArray(participants) || participants.length !== 2 || new Set(participants).size !== participants.length) throw new TypeError("A conversation needs exactly two unique participants.");
    participants.forEach((characterId) => {
      const character = this.#character(characterId);
      if (!character.positionId) throw new Error(`Cannot start a conversation: ${characterId} has no position.`);
      if (character.activity === Activity.SLEEPING) throw new Error(`Cannot start a conversation: ${characterId} is sleeping.`);
      if (character.conversationId) throw new Error(`Cannot start a conversation: ${characterId} is already talking.`);
    });
    const arrangementError = conversationArrangementError(this.#scene, this.#state.characters, participants);
    if (arrangementError) throw new Error(`Cannot start a conversation: ${arrangementError}`);
    const facings = conversationPairFacings(this.#scene, this.#state.characters, participants)!;
    participants.forEach((characterId, index) => { this.#state.characters[characterId].facing = facings[index]; });
    this.#state.conversations[id] = { id, status: ConversationStatus.ACTIVE, participants: [...participants], topic, beats: [] };
    participants.forEach((characterId) => Object.assign(this.#state.characters[characterId], { conversationId: id, activity: Activity.TALKING }));
    return this.snapshot();
  }

  addConversationTurn(conversationId: string, { speakerId, text }: { speakerId: string; text: string }) {
    const conversation = this.#conversation(conversationId);
    if (!conversation.participants.includes(speakerId)) throw new RangeError("The speaker is not part of this conversation.");
    if (!text || typeof text !== "string") throw new TypeError("A turn needs non-empty text.");
    conversation.beats.push({ type: "say", speakerId, text });
    return this.snapshot();
  }

  pauseConversation(conversationId: string) {
    const conversation = this.#conversation(conversationId);
    conversation.beats.push({ type: "pause" });
    return this.snapshot();
  }

  endConversation(conversationId: string) {
    const conversation = this.#conversation(conversationId);
    conversation.participants.forEach((characterId) => {
      const character = this.#state.characters[characterId];
      character.conversationId = null;
      character.activity = Activity.IDLE;
    });
    conversation.status = ConversationStatus.CLOSING;
    return this.snapshot();
  }

  /** Remove conversations that closed during the previous simulation step. */
  finalizeClosingConversations() {
    for (const [id, conversation] of Object.entries(this.#state.conversations)) {
      if (conversation.status === ConversationStatus.CLOSING) delete this.#state.conversations[id];
    }
    return this.snapshot();
  }

  /** Expire one-frame state before asking for the next simulation decision. */
  beginSimulationIteration() {
    this.finalizeClosingConversations();
    this.#state.event = null;
    return this.snapshot();
  }

  addEvent({ type, summary, participants = [] }: EventInput) {
    if (!type || !summary) throw new TypeError("An event needs a type and summary.");
    participants.forEach((characterId) => this.#character(characterId));
    this.#state.event = { type, summary, participants: [...new Set(participants)] };
    return this.snapshot();
  }

  #character(id: string): CharacterState { const character = this.#state.characters[id]; if (!character) throw new RangeError(`Unknown character: ${id}.`); return character; }
  #position(id: string): NormalisedPosition { const position = this.#positions.get(id); if (!position) throw new RangeError(`Unknown position: ${id}.`); return position; }
  #conversation(id: string): Conversation { const conversation = this.#state.conversations[id]; if (conversation?.status !== ConversationStatus.ACTIVE) throw new RangeError(`No active conversation: ${id}.`); return conversation; }
}

export function conversationArrangementError(
  scene: Scene,
  characters: Record<string, Pick<CharacterState, "positionId">>,
  participants: string[],
): string | null {
  if (participants.length !== 2) return "exactly two participants are required.";
  const first = characters[participants[0]];
  const second = characters[participants[1]];
  if (!first?.positionId || !second?.positionId) return "both participants must be placed.";
  return conversationPairFacings(scene, characters, participants) ? null : "participants must occupy one declared conversation pair.";
}

/** Resolve the facing each participant adopts when starting a conversation. */
export function conversationPairFacings(
  scene: Scene,
  characters: Record<string, Pick<CharacterState, "positionId">>,
  participants: string[],
): [FacingDirection, FacingDirection] | null {
  if (participants.length !== 2) return null;
  const firstPosition = characters[participants[0]]?.positionId;
  const secondPosition = characters[participants[1]]?.positionId;
  for (const pair of scene.conversationPairs) {
    if (pair.positions[0] === firstPosition && pair.positions[1] === secondPosition) return [...pair.facings];
    if (pair.positions[1] === firstPosition && pair.positions[0] === secondPosition) return [pair.facings[1], pair.facings[0]];
  }
  return null;
}

function newCharacterState(): CharacterState {
  return {
    positionId: null,
    posture: Posture.STANDING,
    facing: "front",
    activity: Activity.IDLE,
    mood: { valence: 0, energy: 0.5, socialNeed: 0.5, emotionalState: EmotionalState.NEUTRAL },
    memories: [],
    relationships: {},
    conversationId: null,
  };
}

function normalisePosition(position: ScenePosition): NormalisedPosition { return { id: position.id, capacity: position.capacity ?? 1, allowedPostures: position.allowedPostures ?? Object.values(Posture), allowedDirections: position.allowedDirections ?? ["front", "left", "right"] }; }
function assertPosture(posture: PostureValue): void { if (!POSTURES.has(posture)) throw new RangeError(`Unknown posture: ${posture}.`); }
function assertFacing(facing: FacingDirection): void { if (!FACING_DIRECTIONS.has(facing)) throw new RangeError(`Unknown facing direction: ${facing}.`); }
function unit(value: number, label: string): number { if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${label} must be between 0 and 1.`); return value; }
function signed(value: number, label: string): number { if (!Number.isFinite(value) || value < -1 || value > 1) throw new RangeError(`${label} must be between -1 and 1.`); return value; }
function emotion(value: EmotionalState, label: string): EmotionalState { if (!EMOTIONAL_STATES.has(value)) throw new RangeError(`${label} must be happy, sad, angry, or neutral.`); return value; }
