import assert from "node:assert/strict";
import test from "node:test";
import { EmotionalState } from "../engine/state/index.js";
import { characterAssetKey } from "./render-world.js";
import { moodOverlayBounds, topmostHitRegion } from "./mood.js";
import type { CharacterMoodHitRegion } from "./mood.js";

function region(characterId: string, depth: number, x: number): CharacterMoodHitRegion {
  return {
    characterId,
    name: characterId,
    depth,
    bounds: { x, y: 10, width: 20, height: 30 },
    mood: { valence: 0, energy: 0.5, socialNeed: 0.5, emotionalState: EmotionalState.NEUTRAL },
  };
}

test("mood hover hit testing returns the topmost overlapping character", () => {
  const back = region("back", 20, 10);
  const front = region("front", 30, 15);
  assert.equal(topmostHitRegion([front, back], 18, 20)?.characterId, "front");
  assert.equal(topmostHitRegion([front, back], 12, 20)?.characterId, "back");
  assert.equal(topmostHitRegion([front, back], 100, 100), null);
});

test("awake character sprite selection is independent of mood", () => {
  const base = { activity: "idle" as const, posture: "standing" as const, facing: "front" as const };
  assert.equal(characterAssetKey(base), "standing/front/neutral");
  assert.equal(characterAssetKey({ ...base, posture: "sitting", facing: "left" }), "sitting/left/neutral");
});

test("sleeping characters retain their dedicated side-facing sprite", () => {
  assert.equal(characterAssetKey({ activity: "sleeping", posture: "sitting", facing: "front" }), "sitting-sleeping/left");
  assert.equal(characterAssetKey({ activity: "sleeping", posture: "sitting", facing: "right" }), "sitting-sleeping/right");
});

test("mood icon is centered above the character's opaque silhouette", () => {
  assert.deepEqual(moodOverlayBounds({
    characterX: 100,
    characterY: 50,
    characterWidth: 90,
    topOpaqueRow: 16,
    scale: 1.875,
  }, "/assets/moods/happy.png"), {
    url: "/assets/moods/happy.png",
    x: 130,
    y: 46.25,
    width: 30,
    height: 30,
  });
});
