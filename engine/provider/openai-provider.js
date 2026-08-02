import { AIProvider } from "./ai-provider.js";
import { decisionPrompt, DECISION_JSON_SCHEMA } from "../decision/world-rules.js";

/**
 * OpenAI Responses API implementation. Pass an API key at runtime; do not
 * commit it or embed it in client-side production code.
 */
export class OpenAIProvider extends AIProvider {
  constructor({ apiKey, model = "gpt-5.6-sol", fetchImpl = globalThis.fetch }) {
    super();
    if (!apiKey) throw new TypeError("OpenAIProvider requires an API key.");
    if (typeof fetchImpl !== "function") throw new TypeError("OpenAIProvider requires fetch.");
    this.apiKey = apiKey;
    this.model = model;
    this.fetch = fetchImpl;
  }

  async decide(context) {
    const response = await this.fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          { role: "system", content: "You choose the next small, plausible changes in a quiet character simulation. Return only the requested structured decision. Never invent ids." },
          { role: "user", content: decisionPrompt(context) },
        ],
        text: { format: { type: "json_schema", name: "simulation_decision", strict: false, schema: DECISION_JSON_SCHEMA } },
      }),
    });

    if (!response.ok) throw new Error(`OpenAI request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json();
    if (!payload.output_text) throw new Error("OpenAI response did not contain output_text.");
    return JSON.parse(payload.output_text);
  }
}
