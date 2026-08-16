import { Provider } from "./provider.js";
import { DECISION_SYSTEM_PROMPT, decisionPrompt } from "../decision/ai.js";
import { DECISION_JSON_SCHEMA } from "../decision/world-rules.js";
import type { DecisionContext } from "../decision/decision-context.js";
import type { SimulationDecision } from "../state/index.js";

export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "text" | "json">>;

/**
 * OpenAI Responses API implementation. Pass an API key at runtime; do not
 * commit it or embed it in client-side production code.
 */
export class OpenAIProvider extends Provider {
  apiKey: string;
  model: string;
  fetch: FetchImplementation;
  constructor({ apiKey, model = "gpt-5.6-luna", fetchImpl }: { apiKey: string; model?: string; fetchImpl?: FetchImplementation }) {
    super();
    if (!apiKey) throw new TypeError("OpenAIProvider requires an API key.");
    const resolvedFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof resolvedFetch !== "function") throw new TypeError("OpenAIProvider requires fetch.");
    this.apiKey = apiKey;
    this.model = model;
    this.fetch = resolvedFetch;
  }

  async decide(context: DecisionContext): Promise<SimulationDecision> {
    const response = await this.fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          { role: "system", content: DECISION_SYSTEM_PROMPT },
          { role: "user", content: decisionPrompt(context) },
        ],
        max_output_tokens: 2000,
        text: {
          verbosity: "low",
          format: { type: "json_schema", name: "simulation_decision", strict: false, schema: DECISION_JSON_SCHEMA },
        },
      }),
    });

    if (!response.ok) throw new Error(`OpenAI request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json();
    const outputText = responseOutputText(payload);
    if (!outputText) throw new Error("OpenAI response did not contain text output.");
    return JSON.parse(outputText);
  }
}

/**
 * The REST API returns text in output message content. Official SDKs also add
 * an output_text convenience property, which we accept for injected clients.
 */
function responseOutputText(payload: any): string | null {
  if (typeof payload?.output_text === "string" && payload.output_text.length) return payload.output_text;
  if (!Array.isArray(payload?.output)) return null;

  const text = payload.output
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .filter((part: any) => part?.type === "output_text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("");
  return text || null;
}
