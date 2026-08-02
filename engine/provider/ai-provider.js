/** Provider-neutral interface for requesting one simulation decision. */
export class AIProvider {
  async decide(_context) {
    throw new Error("AIProvider.decide(context) must be implemented by a provider.");
  }
}
