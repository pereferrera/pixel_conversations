import type { FacingDirection, PostureValue, Scene, SimulationSnapshot } from "./simulation-state.js";
import { SimulationState } from "./simulation-state.js";

export type RandomSource = () => number;

export interface RandomPlacementOptions {
  state: SimulationState;
  scene: Scene;
  characterIds: string[];
  random?: RandomSource;
}

/**
 * Places characters at distinct random scene positions using only the posture
 * and facing affordances declared by each selected position.
 */
export function placeCharactersRandomly({
  state,
  scene,
  characterIds,
  random = Math.random,
}: RandomPlacementOptions): SimulationSnapshot {
  if (!Array.isArray(characterIds) || new Set(characterIds).size !== characterIds.length) {
    throw new TypeError("characterIds must be unique.");
  }

  const positions = scene.positions.filter((position) =>
    (position.allowedPostures?.length ?? 2) > 0
    && (position.allowedDirections?.length ?? 3) > 0,
  );
  if (positions.length < characterIds.length) {
    throw new RangeError(`Cannot place ${characterIds.length} characters in ${positions.length} available positions.`);
  }

  shuffle(positions, random);
  characterIds.forEach((characterId, index) => {
    const position = positions[index];
    const postures = position.allowedPostures ?? (["standing", "sitting"] as PostureValue[]);
    const directions = position.allowedDirections ?? (["front", "left", "right"] as FacingDirection[]);
    state.placeCharacter(
      characterId,
      position.id,
      pick(postures, random, `posture for ${position.id}`),
      pick(directions, random, `facing for ${position.id}`),
    );
  });
  return state.snapshot();
}

function shuffle<T>(values: T[], random: RandomSource): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const selected = randomIndex(index + 1, random, "position");
    [values[index], values[selected]] = [values[selected], values[index]];
  }
}

function pick<T>(values: T[], random: RandomSource, label: string): T {
  if (!values.length) throw new RangeError(`No values are available for ${label}.`);
  return values[randomIndex(values.length, random, label)];
}

function randomIndex(length: number, random: RandomSource, label: string): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(`Random source must return a number from 0 inclusive to 1 exclusive while selecting ${label}.`);
  }
  return Math.floor(value * length);
}
