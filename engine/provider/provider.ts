import type { DecisionContext } from "../decision/decision-context.js";
import type { SimulationDecision } from "../state/index.js";

/** Provider-neutral interface for requesting one simulation decision. */
export class Provider {
  async decide(_context: DecisionContext): Promise<SimulationDecision> {
    throw new Error("Provider.decide(context) must be implemented by a provider.");
  }
}
