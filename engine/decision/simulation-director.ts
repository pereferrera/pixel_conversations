import { buildDecisionContext, rulesFor } from "./decision-context.js";
import { applyDecision } from "./world-rules.js";
import type { CharacterProfile, Scene, SimulationDecision, SimulationState } from "../state/index.js";
import type { Provider } from "../provider/index.js";
import { resolveSimulationTuning } from "./simulation-tuning.js";
import type { SimulationTuning } from "./simulation-tuning.js";

/** Connects a provider to a SimulationState without coupling either to rendering. */
export class SimulationDirector {
  provider: Provider;
  scene: Scene;
  profiles: CharacterProfile[];
  state: SimulationState;
  tuning: SimulationTuning;
  constructor({ provider, scene, profiles, state, tuning = {} }: { provider: Provider; scene: Scene; profiles: CharacterProfile[]; state: SimulationState; tuning?: Partial<SimulationTuning> }) {
    if (!provider || typeof provider.decide !== "function") throw new TypeError("A provider with decide(context) is required.");
    this.provider = provider;
    this.scene = scene;
    this.profiles = profiles;
    this.state = state;
    this.tuning = resolveSimulationTuning(tuning);
  }

  async decideNext() {
    this.state.beginSimulationIteration();
    const context = buildDecisionContext({ scene: this.scene, profiles: this.profiles, state: this.state.snapshot(), tuning: this.tuning });
    const decision = await this.provider.decide(context);
    const snapshot = applyDecision(this.state, decision, rulesFor(context));
    return { decision, snapshot };
  }
}
