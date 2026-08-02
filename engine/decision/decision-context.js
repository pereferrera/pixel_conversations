import { WorldRules } from "./world-rules.js";

/** Packages every fact the model needs without exposing mutable state. */
export function buildDecisionContext({ scene, profiles, state }) {
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
    rules: { allowedChanges: ["say", "remember", "setMood", "updateRelationship", "placeCharacter", "setPosture", "startConversation", "endConversation", "addEvent"], description: "Only one speaker may add a turn to the same conversation in one step. Every scene place holds one character." },
  };
}

export function rulesFor(context) { return new WorldRules({ scene: context.scene, state: context.state }); }
