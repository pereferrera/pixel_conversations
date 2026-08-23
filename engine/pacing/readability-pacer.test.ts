import assert from "node:assert/strict";
import test from "node:test";
import { ConversationStatus } from "../state/index.js";
import type { SimulationSnapshot } from "../state/index.js";
import { countWords, ReadabilityPacer, readingDurationMs, renderedWorldText } from "./readability-pacer.js";

function snapshot(): SimulationSnapshot {
  return {
    version: 1,
    sceneId: "cafe",
    decisionHistory: [],
    characters: {},
    conversations: {
      chat: {
        id: "chat",
        status: ConversationStatus.ACTIVE,
        participants: ["felix", "grace"],
        topic: null,
        beats: [{ type: "say", speakerId: "felix", text: "A carefully paced sentence." }],
      },
    },
    event: { type: "weather", summary: "Rain starts outside.", participants: [] },
  };
}

test("readability pacing counts only prose visible in the rendered world", () => {
  assert.deepEqual(renderedWorldText(snapshot()), ["A carefully paced sentence.", "Rain starts outside."]);
  assert.equal(countWords(renderedWorldText(snapshot())), 7);
  const paused = snapshot();
  paused.conversations.chat.beats.push({ type: "pause" });
  assert.deepEqual(renderedWorldText(paused), ["Rain starts outside."]);
});

test("250 WPM allocates 240 milliseconds per rendered word", () => {
  assert.equal(readingDurationMs("one two three"), 720);
  assert.equal(readingDurationMs(""), 0);
  assert.throws(() => readingDurationMs("words", 0), /greater than zero/);
});

test("pacer waits only for unread time remaining after provider latency", async () => {
  let now = 1_000;
  const waits: number[] = [];
  const pacer = new ReadabilityPacer({
    now: () => now,
    delay: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; },
  });
  assert.equal(pacer.markRendered("four words are visible"), 960);
  now += 600;
  assert.equal(pacer.remainingMs(), 360);
  assert.equal(await pacer.waitUntilReadable(), 360);
  assert.deepEqual(waits, [360]);
  assert.equal(await pacer.waitUntilReadable(), 0);
});
