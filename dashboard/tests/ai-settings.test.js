import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formFromSettings, modelOptions, priceLabel, saveProblem, settingsLine, switchProvider, testSummary } from "../src/features/overview/ai-settings.js";

const providers = [
  { id: "xai", label: "Grok (xAI)", keyEnv: "XAI_API_KEY", keyConfigured: true, defaultModel: "grok-4.20-0309-non-reasoning",
    models: [{ id: "grok-4.20-0309-non-reasoning", input: 1.25, cachedInput: 0.2, output: 2.5 }, { id: "grok-4.3", input: 1.25, cachedInput: 0.2, output: 2.5 }] },
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY", keyConfigured: false, defaultModel: "gpt-6-luna",
    models: [{ id: "gpt-6-luna", input: 0.1, cachedInput: 0.01, output: 0.5 }] },
];

test("switching provider moves both models to that provider's default", () => {
  const form = formFromSettings({ enabled: false, provider: "xai", recognitionModel: "grok-4.3", draftingModel: "grok-4.3", monthlyCapUsd: 50 });
  assert.deepEqual(switchProvider(form, providers, "openai"), { ...form, provider: "openai", recognitionModel: "gpt-6-luna", draftingModel: "gpt-6-luna" });
  assert.deepEqual(modelOptions(providers, "xai").map((option) => option.value), ["grok-4.20-0309-non-reasoning", "grok-4.3"]);
});

test("Save is blocked when the chosen provider has no key and AI is on, or a model or cap is invalid", () => {
  const base = { enabled: true, provider: "xai", recognitionModel: "grok-4.3", draftingModel: "grok-4.3", monthlyCapUsd: 50 };
  assert.equal(saveProblem(base, providers), "");
  assert.match(saveProblem({ ...base, provider: "openai", recognitionModel: "gpt-6-luna", draftingModel: "gpt-6-luna" }, providers), /OPENAI_API_KEY in Vercel/);
  assert.equal(saveProblem({ ...base, enabled: false, provider: "openai", recognitionModel: "gpt-6-luna", draftingModel: "gpt-6-luna" }, providers), "", "an Admin may pick a provider while AI is off");
  assert.match(saveProblem({ ...base, recognitionModel: "gpt-6-luna" }, providers), /from the list/);
  assert.match(saveProblem({ ...base, monthlyCapUsd: -1 }, providers), /between \$0 and \$10,000/);
});

test("labels: prices, test results and history lines", () => {
  assert.equal(priceLabel(providers[0].models[0]), "$1.25 in / $2.5 out per 1M tokens · cached $0.2");
  assert.equal(testSummary({ correct: 9, total: 10, ms: 1420, costMicroUsd: 600 }), "9/10 correct · 1.4 s · $0.0006");
  assert.equal(settingsLine({ enabled: true, provider: "xai", recognitionModel: "grok-4.3", monthlyCapUsd: 50 }), "On · Grok (xAI) · grok-4.3 · cap $50");
});

test("the dialog never asks for or shows API keys", () => {
  const modal = readFileSync(new URL("../src/features/overview/ai-settings-modal.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(modal, /Input\.Password|apiKey|type="password"/);
  assert.match(modal, /API keys are set in Vercel and never shown here\./);
});
