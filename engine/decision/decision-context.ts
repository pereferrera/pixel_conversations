import { WorldRules } from "./world-rules.js";
import { ChangeType, Posture } from "../state/index.js";
import type { CharacterProfile, ConversationPair, FacingDirection, PostureValue, Scene, SimulationSnapshot } from "../state/index.js";
import { resolveSimulationTuning } from "./simulation-tuning.js";
import type { SimulationTuning } from "./simulation-tuning.js";

export interface DecisionPosition {
  id: string;
  label: string;
  kind: "standing" | "seat";
  allowedPostures: PostureValue[];
  allowedDirections: FacingDirection[];
  occupiedBy: string | null;
}

export interface ActionDefinition {
  type: ChangeType;
  description: string;
  fields: Record<string, string>;
  constraints?: string[];
}

export const ACTION_CATALOG: Record<ChangeType, ActionDefinition> = {
  [ChangeType.SAY]: {
    type: ChangeType.SAY,
    description: "Record the exact words one participant speaks in an active or just-started conversation.",
    fields: { conversationId: "active conversation id, equal to startConversation.id when just started", speakerId: "participant character id", text: "exact non-empty spoken dialogue" },
    constraints: ["This is the only action that records spoken dialogue.", "Place it after startConversation when opening a new conversation."],
  },
  [ChangeType.REMEMBER]: {
    type: ChangeType.REMEMBER,
    description: "Store a rare, durable memory for one character.",
    fields: { characterId: "character id", memory: "{ summary: string, importance?: 0..1 }" },
    constraints: ["Use after a conversation ends or for a genuinely extraordinary event or sentence.", "Do not create routine memories."],
  },
  [ChangeType.SET_MOOD]: {
    type: ChangeType.SET_MOOD,
    description: "Update one or more immediate mood dimensions, including the concrete visible emotional state when circumstances warrant it.",
    fields: { characterId: "character id", mood: "{ valence?: -1..1, energy?: 0..1, socialNeed?: 0..1, emotionalState?: happy | sad | angry | afraid | neutral }" },
    constraints: ["Only happy, sad, angry, afraid, and neutral are valid emotional states.", "The model decides when events or social interactions justify an emotional-state change."],
  },
  [ChangeType.UPDATE_RELATIONSHIP]: { type: ChangeType.UPDATE_RELATIONSHIP, description: "Update one character's directed relationship toward another.", fields: { fromId: "character id", toId: "different character id", relationship: "{ affinity?: -1..1, trust?: -1..1 }" } },
  [ChangeType.PLACE_CHARACTER]: {
    type: ChangeType.PLACE_CHARACTER,
    description: "Move or place a character at a scene position.",
    fields: { characterId: "character id", positionId: "scene position id", posture: "posture allowed by that position", facing: "optional direction allowed by that position" },
    constraints: ["A position holds one character.", "Use this action to move between standing positions and seats."],
  },
  [ChangeType.SET_POSTURE]: { type: ChangeType.SET_POSTURE, description: "Change posture without changing the current position.", fields: { characterId: "placed character id", posture: "posture allowed by the current position" } },
  [ChangeType.SET_ACTIVITY]: {
    type: ChangeType.SET_ACTIVITY,
    description: "Change an available character between idle and sleeping.",
    fields: { characterId: "placed character id", activity: "idle | sleeping" },
    constraints: ["Sleeping is allowed only while sitting.", "Talking is managed by conversation lifecycle actions and cannot be set directly."],
  },
  [ChangeType.START_CONVERSATION]: {
    type: ChangeType.START_CONVERSATION,
    description: "Create the conversation object and assign its id to all participants.",
    fields: { id: "new unique conversation id; later say/endConversation actions use this as conversationId", participants: "exactly two unique, placed, available character ids", topic: "optional topic label, never dialogue" },
    constraints: ["This is the only action that creates a conversation.", "Participants must already occupy one scene conversationPair; starting automatically turns them to that pair's facings.", "Follow it with say to record the opening words."],
  },
  [ChangeType.END_CONVERSATION]: {
    type: ChangeType.END_CONVERSATION,
    description: "Close an active conversation and release its participants.",
    fields: { conversationId: "active conversation id" },
    constraints: ["This is the only action that ends a conversation.", "Do not use addEvent to end one."],
  },
  [ChangeType.PAUSE_CONVERSATION]: {
    type: ChangeType.PAUSE_CONVERSATION,
    description: "Advance an active conversation by one attentive beat in which nobody speaks.",
    fields: { conversationId: "active conversation id" },
    constraints: ["Use for a meaningful listening or reflective beat.", "Do not pair with say for the same conversation in one step."],
  },
  [ChangeType.ADD_EVENT]: {
    type: ChangeType.ADD_EVENT,
    description: "Record a meaningful non-conversation world occurrence.",
    fields: { event: "{ type: string, summary: string, participants?: character id[] }" },
    constraints: ["At most one event may be added per simulation step, alongside any other necessary actions.", "An event is visible for one resulting frame and expires before the next step.", "Never use this for speech, dialogue, starting a conversation, or ending a conversation.", "Narrated speech is not a substitute for a say action with exact text."],
  },
};

export interface DecisionContext {
  scene: { id: string; positions: DecisionPosition[]; conversationPairs: ConversationPair[] };
  characters: CharacterProfile[];
  state: SimulationSnapshot;
  tuning: SimulationTuning;
  rules: {
    allowedChanges: ChangeType[];
    constraints: string[];
    actions: Record<ChangeType, ActionDefinition>;
  };
}

/** Packages model-relevant semantics while withholding renderer-only geometry. */
export function buildDecisionContext({ scene, profiles, state, tuning = {} }: { scene: Scene; profiles: CharacterProfile[]; state: SimulationSnapshot; tuning?: Partial<SimulationTuning> }): DecisionContext {
  if (!scene?.id || !Array.isArray(scene.positions)) throw new TypeError("A scene definition is required.");
  if (!Array.isArray(profiles)) throw new TypeError("Character profiles are required.");
  const snapshot = structuredClone(state);
  const profileIds = new Set(profiles.map((profile) => profile.id));
  for (const characterId of Object.keys(snapshot.characters)) {
    if (!profileIds.has(characterId)) throw new RangeError(`Missing profile for ${characterId}.`);
  }
  const positions = scene.positions.map((position): DecisionPosition => ({
    id: position.id,
    label: position.label ?? position.id,
    kind: position.kind ?? "standing",
    allowedPostures: structuredClone(position.allowedPostures ?? Object.values(Posture)),
    allowedDirections: structuredClone(position.allowedDirections ?? ["front", "left", "right"]),
    occupiedBy: Object.entries(snapshot.characters).find(([, character]) => character.positionId === position.id)?.[0] ?? null,
  }));
  return {
    scene: { id: scene.id, positions, conversationPairs: structuredClone(scene.conversationPairs) },
    characters: structuredClone(profiles),
    state: snapshot,
    tuning: resolveSimulationTuning(tuning),
    rules: {
      allowedChanges: Object.values(ChangeType),
      constraints: [
        "Return between 1 and 12 changes.",
        "Only one speaker may add a turn to the same conversation in one step.",
        "Every scene position holds one character.",
        "A conversation has exactly two participants. Before startConversation, place them in one scene.conversationPairs arrangement. Starting automatically turns both participants to the pair's listed facings.",
        "Conversation participants cannot move until endConversation releases them.",
        "Posture is only standing or sitting. Sleeping is an activity and is allowed only while sitting.",
        "Only startConversation creates conversations, only say records exact spoken words, and only endConversation closes conversations.",
        "endConversation marks a conversation as closing so its final speech remains visible. Closing conversations accept no more beats and are deleted automatically before the next simulation step.",
        "pauseConversation represents one active-conversation beat with no speech.",
        "addEvent never represents dialogue or conversation lifecycle.",
        "At most one event may be active. It describes a meaningful non-dialogue occurrence for one rendered frame and expires before the next simulation step.",
        "Every change object must use the field \"type\" as its action discriminator; never use \"action\".",
        "Use only ids, postures, and directions present in this context.",
      ],
      actions: structuredClone(ACTION_CATALOG),
    },
  };
}

export function rulesFor(context: DecisionContext): WorldRules { return new WorldRules({ scene: context.scene, state: context.state }); }
