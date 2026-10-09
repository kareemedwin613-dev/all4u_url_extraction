// Helpers for the Admin "AI Autofill settings" dialog. The server owns the model list and prices; keys stay on
// the server, and the dialog only learns whether each provider's key is set.

export const priceLabel = (model) => model ? `$${model.input} in / $${model.output} out per 1M tokens${model.cachedInput < model.input ? ` · cached $${model.cachedInput}` : ""}` : "";

export function modelOptions(providers, providerId) {
  const provider = (providers || []).find((item) => item.id === providerId);
  return (provider?.models || []).map((model) => ({ value: model.id, label: model.id, model }));
}

export function formFromSettings(settings) {
  return {
    enabled: Boolean(settings?.enabled), provider: settings?.provider || "xai",
    recognitionModel: settings?.recognitionModel || "", draftingModel: settings?.draftingModel || "",
    monthlyCapUsd: Number.isFinite(Number(settings?.monthlyCapUsd)) ? Number(settings.monthlyCapUsd) : 50,
  };
}

// Switching provider moves both models to that provider's default.
export function switchProvider(form, providers, providerId) {
  const provider = (providers || []).find((item) => item.id === providerId);
  return provider ? { ...form, provider: providerId, recognitionModel: provider.defaultModel, draftingModel: provider.defaultModel } : form;
}

// Why Save is not allowed, or "" when it is.
export function saveProblem(form, providers) {
  const provider = (providers || []).find((item) => item.id === form.provider);
  if (!provider) return "Choose a provider.";
  if (form.enabled && !provider.keyConfigured) return `Add ${provider.keyEnv} in Vercel before turning on ${provider.label}.`;
  const ids = new Set(provider.models.map((model) => model.id));
  if (!ids.has(form.recognitionModel) || !ids.has(form.draftingModel)) return "Choose models from the list.";
  if (!(Number(form.monthlyCapUsd) >= 0 && Number(form.monthlyCapUsd) <= 10000)) return "The monthly cap must be between $0 and $10,000.";
  return "";
}

export function testSummary(result) {
  if (!result) return "";
  const usd = (Number(result.costMicroUsd) || 0) / 1_000_000;
  return `${result.correct}/${result.total} correct · ${(result.ms / 1000).toFixed(1)} s · $${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

export function settingsLine(settings) {
  if (!settings) return "";
  return `${settings.enabled ? "On" : "Off"} · ${settings.provider === "openai" ? "OpenAI" : "Grok (xAI)"} · ${settings.recognitionModel} · cap $${Number(settings.monthlyCapUsd || 0)}`;
}
