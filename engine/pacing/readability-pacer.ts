import { ConversationStatus } from "../state/index.js";
import type { SimulationSnapshot } from "../state/index.js";

export const DEFAULT_READING_WORDS_PER_MINUTE = 250;

export type ReadabilityClock = () => number;
export type ReadabilityDelay = (milliseconds: number) => Promise<void>;

export interface ReadabilityPacerOptions {
  wordsPerMinute?: number;
  now?: ReadabilityClock;
  delay?: ReadabilityDelay;
}

/** Returns only the prose currently painted by the production world renderer. */
export function renderedWorldText(state: SimulationSnapshot): string[] {
  const text: string[] = [];
  const latestBeat = Object.values(state.conversations)
    .filter(({ status }) => status === ConversationStatus.ACTIVE || status === ConversationStatus.CLOSING)
    .at(-1)?.beats.at(-1);
  if (latestBeat?.type === "say") text.push(latestBeat.text);
  if (state.event) text.push(state.event.summary);
  return text;
}

export function countWords(text: string | readonly string[]): number {
  const combined = (typeof text === "string" ? [text] : text).join(" ").trim();
  return combined ? combined.split(/\s+/u).length : 0;
}

export function readingDurationMs(text: string | readonly string[], wordsPerMinute = DEFAULT_READING_WORDS_PER_MINUTE): number {
  if (!Number.isFinite(wordsPerMinute) || wordsPerMinute <= 0) throw new RangeError("wordsPerMinute must be greater than zero.");
  return countWords(text) * 60_000 / wordsPerMinute;
}

/** Tracks how long the currently rendered prose should remain visible. */
export class ReadabilityPacer {
  readonly wordsPerMinute: number;
  readonly #now: ReadabilityClock;
  readonly #delay: ReadabilityDelay;
  #readableAt = 0;

  constructor({
    wordsPerMinute = DEFAULT_READING_WORDS_PER_MINUTE,
    now = Date.now,
    delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }: ReadabilityPacerOptions = {}) {
    if (!Number.isFinite(wordsPerMinute) || wordsPerMinute <= 0) throw new RangeError("wordsPerMinute must be greater than zero.");
    this.wordsPerMinute = wordsPerMinute;
    this.#now = now;
    this.#delay = delay;
  }

  markRendered(text: string | readonly string[], renderedAt = this.#now()): number {
    const duration = readingDurationMs(text, this.wordsPerMinute);
    this.#readableAt = renderedAt + duration;
    return duration;
  }

  remainingMs(at = this.#now()): number {
    return Math.max(0, this.#readableAt - at);
  }

  async waitUntilReadable(): Promise<number> {
    const remaining = this.remainingMs();
    if (remaining > 0) await this.#delay(remaining);
    return remaining;
  }
}
