// POST /api/login — checks the site password against APP_PASSWORD env var.
// Purely a gate to stop strangers burning the OpenRouter credits.
function timingSafeEqual(a, b) {
  // Constant-ish time compare to avoid trivial timing oracles.
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

module.exports = (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: "Server is missing APP_PASSWORD configuration." });
    return;
  }
  const body = req.body || {};
  const given = typeof body.password === "string" ? body.password : "";
  if (!timingSafeEqual(given, expected)) {
    res.status(401).json({ ok: false, error: "Wrong password." });
    return;
  }
  res.status(200).json({ ok: true });
};
