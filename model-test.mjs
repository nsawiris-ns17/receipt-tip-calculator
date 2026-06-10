// Model bake-off: runs each candidate vision model against the test receipts,
// THREE times per receipt, and scores accuracy / consistency / latency.
// Usage: OPENROUTER_API_KEY=... node model-test.mjs
//   Optional: MODELS="a,b,c" RUNS=3 node model-test.mjs
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("Set OPENROUTER_API_KEY"); process.exit(1); }

const RUNS = Number(process.env.RUNS || 3); // "make it three times and pick the best one"
const DIR = path.resolve("test-output");
const RECEIPTS = [
  { file: "receipt1.png", truth: { merchant: "THE CORNER BISTRO", subtotal: 45.25, tax: 3.62, total: 48.87 } },
  { file: "receipt2.png", truth: { merchant: "Sakura Ramen House", subtotal: 52.0, tax: 4.62, total: 56.62 } },
  { file: "receipt3.png", truth: { merchant: "Blue Bottle Coffee", subtotal: 13.5, tax: 1.18, total: 18.68, tip: 4.0 } },
];

// Candidate models to evaluate. The best 3 are kept for the app dropdown (lib/models.js).
const CANDIDATES = process.env.MODELS
  ? process.env.MODELS.split(",")
  : [
      "google/gemini-2.0-flash-001",
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
      "meta-llama/llama-3.2-11b-vision-instruct",
      "mistralai/pixtral-12b",
    ];

const PROMPT = [
  "You are reading a restaurant or store receipt from an image.",
  "Extract the monetary amounts and respond with ONLY a JSON object — no prose, no markdown fences.",
  "Keys:",
  '  "merchant": store/restaurant name as a string, or null',
  '  "currency": ISO code like "USD" if visible, else null',
  '  "subtotal": pre-tax subtotal as a number, or null',
  '  "tax": tax amount as a number, or null',
  '  "total": final total amount due as a number, or null',
  '  "tip_already_on_receipt": a gratuity/tip line if already printed, as a number, or null',
  "Numbers must be plain (no symbols, no thousands separators). Use null when not clearly present.",
].join("\n");

function dataUrl(file) {
  const buf = fs.readFileSync(path.join(DIR, file));
  return "data:image/png;base64," + buf.toString("base64");
}
function extractJson(text) {
  if (!text) return null;
  let c = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(c); } catch {}
  const s = c.indexOf("{"); if (s === -1) return null;
  let depth = 0;
  for (let i = s; i < c.length; i++) {
    if (c[i] === "{") depth++;
    else if (c[i] === "}") { depth--; if (depth === 0) { try { return JSON.parse(c.slice(s, i + 1)); } catch { return null; } } }
  }
  return null;
}
const num = (v) => { if (v == null) return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };
const close = (a, b) => a != null && b != null && Math.abs(a - b) < 0.01;

async function callModel(model, url) {
  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "X-Title": "Receipt Tip Test" },
    body: JSON.stringify({
      model, max_tokens: 600, temperature: 0,
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url } }] }],
    }),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) return { ok: false, latencyMs, error: (await res.text()).slice(0, 160) };
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content || "";
  const parsed = extractJson(typeof text === "string" ? text : JSON.stringify(text));
  return { ok: true, latencyMs, parsed, raw: String(text).slice(0, 120) };
}

const urls = Object.fromEntries(RECEIPTS.map((r) => [r.file, dataUrl(r.file)]));
const summary = [];

for (const model of CANDIDATES) {
  let totalHits = 0, subHits = 0, jsonOk = 0, attempts = 0, lat = 0, okCalls = 0, fails = 0;
  let consistentReceipts = 0;
  console.log(`\n=== ${model}  (${RUNS} runs/receipt) ===`);
  for (const r of RECEIPTS) {
    const totalsThisReceipt = [];
    for (let run = 1; run <= RUNS; run++) {
      attempts++;
      let out;
      try { out = await callModel(model, urls[r.file]); }
      catch (e) { out = { ok: false, error: String(e).slice(0, 120) }; }
      if (!out.ok) { fails++; console.log(`  ${r.file} #${run}: ERROR ${out.error}`); continue; }
      okCalls++; lat += out.latencyMs;
      const p = out.parsed;
      if (p) jsonOk++;
      const gotTotal = p ? num(p.total) : null;
      const gotSub = p ? num(p.subtotal) : null;
      const tOk = close(gotTotal, r.truth.total);
      const sOk = close(gotSub, r.truth.subtotal);
      if (tOk) totalHits++;
      if (sOk) subHits++;
      totalsThisReceipt.push(gotTotal);
      console.log(`  ${r.file} #${run}: total=${gotTotal} (${tOk ? "OK" : "MISS exp " + r.truth.total}) subtotal=${gotSub} (${sOk ? "OK" : "miss"}) ${out.latencyMs}ms`);
    }
    // consistent = all successful runs returned the same total
    const vals = totalsThisReceipt.filter((v) => v != null);
    if (vals.length === RUNS && vals.every((v) => close(v, vals[0]))) consistentReceipts++;
  }
  summary.push({
    model,
    totalAcc: `${totalHits}/${attempts}`,
    totalAccPct: Math.round((100 * totalHits) / attempts),
    subAcc: `${subHits}/${attempts}`,
    jsonValid: `${jsonOk}/${attempts}`,
    consistent: `${consistentReceipts}/${RECEIPTS.length}`,
    avgLatencyMs: okCalls ? Math.round(lat / okCalls) : null,
    fails,
  });
}

// Winner: highest total accuracy, tie-break on lower latency.
summary.sort((a, b) => (b.totalAccPct - a.totalAccPct) || ((a.avgLatencyMs ?? 1e9) - (b.avgLatencyMs ?? 1e9)));
console.log("\n\n========== SUMMARY (sorted best-first) ==========");
console.table(summary);
const winner = summary[0];
console.log(`\nWINNER: ${winner.model}  —  ${winner.totalAccPct}% total accuracy, ${winner.avgLatencyMs}ms avg, consistency ${winner.consistent}`);
fs.writeFileSync(path.join(DIR, "results.json"), JSON.stringify({ runsPerReceipt: RUNS, summary, winner: winner.model }, null, 2));
console.log("Saved test-output/results.json");
