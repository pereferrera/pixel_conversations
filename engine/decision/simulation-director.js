import { buildDecisionContext, rulesFor } from "./decision-context.js";
import { applyDecision } from "./world-rules.js";

/** Connects a provider to a SimulationState without coupling either to rendering. */
export class SimulationDirector {
  constructor({ provider, scene, profiles, state }) {
    if (!provider || typeof provider.decide !== "function") throw new TypeError("A provider with decide(context) is required.");
    this.provider = provider;
    this.scene = scene;
    this.profiles = profiles;
    this.state = state;
  }

  async decideNext() {
    const context = buildDecisionContext({ scene: this.scene, profiles: this.profiles, state: this.state.snapshot() });
    const decision = await this.provider.decide(context);
    const snapshot = applyDecision(this.state, decision, rulesFor(context));
    return { decision, snapshot };
  }
}
