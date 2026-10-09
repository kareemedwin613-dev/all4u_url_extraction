// Providers and models an Admin can choose on the dashboard, with prices for cost tracking and the monthly cap.
// US dollars per million tokens, for requests under 200k tokens (ours are a few thousand). Checked 2026-10-08.
// A model must be listed here to be selectable, so every call is priced. API keys come only from the environment.

export type ProviderId = "openai" | "xai";
export interface ModelInfo { id: string; input: number; cachedInput: number; output: number; note?: string }
export interface ProviderInfo { label: string; keyEnv: "OPENAI_API_KEY" | "XAI_API_KEY"; defaultModel: string; models: ModelInfo[] }

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  xai: {
    label: "Grok (xAI)", keyEnv: "XAI_API_KEY", defaultModel: "grok-4.20-0309-non-reasoning",
    models: [
      { id: "grok-4.20-0309-non-reasoning", input: 1.25, cachedInput: 0.20, output: 2.50, note: "Fast; no hidden reasoning tokens" },
      { id: "grok-4.3", input: 1.25, cachedInput: 0.20, output: 2.50 },
      { id: "grok-build-0.1", input: 1.00, cachedInput: 0.20, output: 2.00, note: "Cheapest; built for coding" },
      { id: "grok-4.5", input: 2.00, cachedInput: 0.30, output: 6.00, note: "Flagship" },
      { id: "grok-4.7", input: 2.00, cachedInput: 0.50, output: 6.00, note: "Latest flagship" },
    ],
  },
  openai: {
    label: "OpenAI", keyEnv: "OPENAI_API_KEY", defaultModel: "gpt-6-luna",
    models: [
      { id: "gpt-6-luna", input: 0.10, cachedInput: 0.01, output: 0.50, note: "Lean plan" },
      { id: "gpt-6.1-sol", input: 2.00, cachedInput: 2.00, output: 10.00, note: "Balanced plan; cached price not published, charged in full" },
    ],
  },
};

export const isProvider = (value: unknown): value is ProviderId => value === "openai" || value === "xai";
export const findModel = (provider: ProviderId, model: string) => PROVIDERS[provider]?.models.find((item) => item.id === model) || null;

// Unknown models are charged at the highest listed price, so the cap stays safe.
const HIGHEST: ModelInfo = { id: "unknown", input: 2.00, cachedInput: 2.00, output: 10.00 };
export function costMicroUsd(provider: ProviderId, model: string, inputTokens: number, cachedTokens: number, outputTokens: number) {
  const price = findModel(provider, model) || HIGHEST, cached = Math.max(0, Math.min(cachedTokens || 0, inputTokens || 0));
  return Math.ceil((inputTokens - cached) * price.input + cached * price.cachedInput + outputTokens * price.output);
}
