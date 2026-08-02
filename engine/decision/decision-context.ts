import { WorldRules } from "./world-rules.js";
import { ChangeType } from "../state/index.js";
import type { CharacterProfile, Scene, SimulationSnapshot } from "../state/index.js";

export interface DecisionContext {
  scene: Scene;
  characters: CharacterProfile[];
  state: SimulationSnapshot;
  rules: { allowedChanges: ChangeType[]; description: string };
}

/** Packages every fact the model needs without exposing mutable state. */
export function buildDecisionContext({ scene, profiles, state }: { scene: Scene; profiles: CharacterProfile[]; state: SimulationSnapshot }): DecisionContext {
  if (!scene?.id || !Array.isArray(scene.positions)) throw new TypeError("A scene definition is required.");
  if (!Array.isArray(profiles)) throw new TypeError("Character profiles are required.");
  const snapshot = structuredClone(state);
  const profileIds = new Set(profiles.map((profile) => profile.id));
  for (const characterId of Object.keys(snapshot.characters)) {
    if (!profileIds.has(characterId)) throw new RangeError(`Missing profile for ${characterId}.`);
  }
  return {
    scene: structuredClone(scene),
    characters: structuredClone(profiles),
    state: snapshot,
    rules: { allowedChanges: Object.values(ChangeType), description: "Only one speaker may add a turn to the same conversation in one step. Every scene place holds one character." },
  };
}

export function rulesFor(context: DecisionContext): WorldRules { return new WorldRules({ scene: context.scene, state: context.state }); }
