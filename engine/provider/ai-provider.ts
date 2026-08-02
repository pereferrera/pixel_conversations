import type { SimulationDecision } from "../state/index.js";

/** Provider-neutral interface for requesting one simulation decision. */
export class AIProvider {
  async decide(_context: unknown): Promise<SimulationDecision> {
    throw new Error("AIProvider.decide(context) must be implemented by a provider.");
  }
}
