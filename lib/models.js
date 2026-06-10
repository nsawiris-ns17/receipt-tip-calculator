// Single source of truth for which models the app is allowed to use.
// Used by the dropdown (api/models.js) AND enforced as an allowlist (api/analyze.js),
// so nobody can swap in an arbitrary / expensive model against the API key.
//
// NOTE: `default` is set to the winner of the model bake-off (see README / model-test.mjs).
const MODELS = [
  {
    id: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    note: "Fast, cheap, strong at reading receipts.",
  },
  {
    id: "openai/gpt-4o-mini",
    label: "GPT-4o mini",
    note: "Reliable structured output, solid OCR.",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude 3.5 Sonnet",
    note: "Most thorough reader, a bit pricier.",
  },
];

const DEFAULT_MODEL = "google/gemini-2.0-flash-001";

module.exports = { MODELS, DEFAULT_MODEL };
