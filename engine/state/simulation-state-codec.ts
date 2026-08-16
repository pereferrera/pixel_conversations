import { SimulationState } from "./simulation-state.js";
import type { Scene, SimulationSnapshot } from "./simulation-state.js";

export interface RestoreSimulationStateOptions { scene: Scene; memoryLimit?: number }

/** Convert a live state or detached snapshot to its portable JSON representation. */
export function serializeSimulationState(state: SimulationState | SimulationSnapshot, space?: number): string {
  return JSON.stringify(state instanceof SimulationState ? state.snapshot() : state, null, space);
}

/** Parse and validate a state JSON document without replaying simulation mutations. */
export function deserializeSimulationState(json: string, options: RestoreSimulationStateOptions): SimulationState {
  if (typeof json !== "string") throw new TypeError("Serialized simulation state must be a JSON string.");
  return restoreSimulationState(JSON.parse(json), options);
}

/** Validate and defensively copy a decoded snapshot without replaying simulation mutations. */
export function restoreSimulationState(snapshot: unknown, { scene, memoryLimit }: RestoreSimulationStateOptions): SimulationState {
  return SimulationState.fromSnapshot({ scene, snapshot, memoryLimit });
}
