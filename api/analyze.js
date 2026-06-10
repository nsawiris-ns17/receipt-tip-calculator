// POST /api/analyze — the only endpoint that touches the OpenRouter key.
// Security model:
//   1. Requires the correct site password (APP_PASSWORD) -> stops credit abuse.
//   2. Reads OPENROUTER_API_KEY from env only; never returned to the client.
//   3. Only allows models on the allowlist (lib/models.js) -> no expensive-model swaps.
const { MODELS } = require("../lib/models.js");

const ALLOWED = new Set(MODELS.map((m) => m.id));
const MAX_IMAGE_CHARS = 8_000_000; // ~6MB decoded; client resizes well below this.

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// Pull the first balanced JSON object out of a model's text response.
function extractJson(text) {
  if (!text) return null;
  let cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const PROMPT = [
  "You are reading a restaurant or store receipt from an image.",
  "Extract the monetary amounts and respond with ONLY a JSON object — no prose, no markdown fences.",
  "Keys:",
  '  "merchant": store/restaurant name as a string, or null',
  '  "currency": ISO code like "USD" if visible, else null',
  '  "subtotal": pre-tax subtotal as a number, or null',
  '  "tax": tax amount as a number, or null',
  '  "total": final total amount due as a number, or null',
  '  "tip_already_on_receipt": a gratuity/tip line if one is already printed, as a number, or null',
  "Numbers must be plain (no currency symbols, no thousands separators). Use null when a value is not clearly present.",
].join("\n");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const expectedPw = process.env.APP_PASSWORD;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!expectedPw || !apiKey) {
    res.status(500).json({ error: "Server is not fully configured (missing env vars)." });
    return;
  }

  const body = req.body || {};
  if (!timingSafeEqual(typeof body.password === "string" ? body.password : "", expectedPw)) {
    res.status(401).json({ error: "Wrong password." });
    return;
  }

  const model = typeof body.model === "string" ? body.model : "";
  if (!ALLOWED.has(model)) {
    res.status(400).json({ error: "Model not allowed." });
    return;
  }

  const image = typeof body.image === "string" ? body.image : "";
  if (!image.startsWith("data:image/")) {
    res.status(400).json({ error: "Provide a receipt image as a data URL." });
    return;
  }
  if (image.length > MAX_IMAGE_CHARS) {
    res.status(413).json({ error: "Image too large after upload." });
    return;
  }

  const started = Date.now();
  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://receipt-tip.vercel.app",
        "X-Title": "Receipt Tip Reader",
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
      }),
    });

    const latencyMs = Date.now() - started;

    if (!orRes.ok) {
      const errText = await orRes.text();
      res.status(502).json({ error: "Model request failed.", detail: errText.slice(0, 500), latencyMs });
      return;
    }

    const payload = await orRes.json();
    const text = payload?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(typeof text === "string" ? text : JSON.stringify(text));

    if (!parsed) {
      res.status(200).json({ ok: false, error: "Could not parse a total from the receipt.", model, latencyMs, raw: String(text).slice(0, 400) });
      return;
    }

    const data = {
      merchant: typeof parsed.merchant === "string" ? parsed.merchant : null,
      currency: typeof parsed.currency === "string" ? parsed.currency : null,
      subtotal: toNumber(parsed.subtotal),
      tax: toNumber(parsed.tax),
      total: toNumber(parsed.total),
      tipAlready: toNumber(parsed.tip_already_on_receipt),
    };

    res.status(200).json({ ok: true, data, model, latencyMs });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error contacting the model.", detail: String(err).slice(0, 300) });
  }
};
