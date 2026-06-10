// GET /api/models — returns the public list of selectable models for the dropdown.
// No secrets here; safe to expose. Keeps the dropdown in sync with the server allowlist.
const { MODELS, DEFAULT_MODEL } = require("../lib/models.js");

module.exports = (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.status(200).json({ models: MODELS, default: DEFAULT_MODEL });
};
