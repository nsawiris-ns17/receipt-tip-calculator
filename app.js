// Receipt Tip Reader — frontend logic. No secrets here.
// The password is held in sessionStorage only to re-send with each API call;
// it is verified server-side every time.

const $ = (id) => document.getElementById(id);
const PW_KEY = "rtr_pw";

// ---------- Password gate ----------
const gate = $("gate");
const app = $("app");
const gateForm = $("gateForm");
const gateError = $("gateError");

async function tryUnlock(password) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return res.ok;
}

function showApp() {
  gate.hidden = true;
  app.hidden = false;
  loadModels();
}

gateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  gateError.hidden = true;
  const pw = $("password").value;
  const btn = $("unlockBtn");
  btn.disabled = true;
  btn.textContent = "Checking…";
  const ok = await tryUnlock(pw).catch(() => false);
  btn.disabled = false;
  btn.textContent = "Unlock";
  if (ok) {
    sessionStorage.setItem(PW_KEY, pw);
    showApp();
  } else {
    gateError.hidden = false;
  }
});

$("lockBtn").addEventListener("click", () => {
  sessionStorage.removeItem(PW_KEY);
  location.reload();
});

// Auto-enter if we already have a valid password this session
(async function bootstrap() {
  const saved = sessionStorage.getItem(PW_KEY);
  if (saved && (await tryUnlock(saved).catch(() => false))) showApp();
})();

// ---------- Model dropdown ----------
const modelSelect = $("model");
const modelHint = $("modelHint");
let MODELS = [];

async function loadModels() {
  try {
    const res = await fetch("/api/models");
    const json = await res.json();
    MODELS = json.models || [];
    modelSelect.innerHTML = "";
    for (const m of MODELS) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      if (m.id === json.default) opt.selected = true;
      modelSelect.appendChild(opt);
    }
    updateModelHint();
  } catch (_) {
    modelHint.textContent = "Could not load model list.";
  }
}
function updateModelHint() {
  const m = MODELS.find((x) => x.id === modelSelect.value);
  modelHint.textContent = m ? m.note : "";
}
modelSelect.addEventListener("change", updateModelHint);

// ---------- Image upload + resize ----------
const fileInput = $("file");
const dropzone = $("dropzone");
const preview = $("preview");
const dropPrompt = $("dropPrompt");
const readBtn = $("readBtn");
let imageDataUrl = null;

function resizeImage(file, maxDim, quality) {
  maxDim = maxDim || 1400;
  quality = quality || 0.82;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.width, height = img.height;
      if (Math.max(width, height) > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  try {
    imageDataUrl = await resizeImage(file);
    preview.src = imageDataUrl;
    preview.hidden = false;
    dropPrompt.hidden = true;
    readBtn.disabled = false;
  } catch (err) {
    setStatus("Couldn't read that image. Try another.", true);
  }
}

fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("is-drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("is-drag"); })
);
dropzone.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

// ---------- Status ----------
const statusEl = $("status");
function setStatus(msg, isError, spinner) {
  if (!msg) { statusEl.hidden = true; return; }
  statusEl.hidden = false;
  statusEl.className = "status" + (isError ? " status--error" : "");
  statusEl.innerHTML = (spinner ? '<span class="spinner"></span>' : "") + msg;
}

// ---------- Analyze ----------
const readout = $("readout");
const tipPanel = $("tipPanel");
let extracted = null;

readBtn.addEventListener("click", async () => {
  if (!imageDataUrl) return;
  const password = sessionStorage.getItem(PW_KEY) || "";
  readBtn.disabled = true;
  setStatus("Reading the receipt…", false, true);
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, model: modelSelect.value, image: imageDataUrl }),
    });
    const json = await res.json();
    if (res.status === 401) { setStatus("Session expired — please unlock again.", true); return; }
    if (!res.ok) { setStatus(json.error || "Something went wrong.", true); return; }
    if (!json.ok) { setStatus(json.error || "Couldn't read a total from that receipt.", true); return; }

    extracted = json.data;
    renderReadout(json);
    setStatus("");
  } catch (err) {
    setStatus("Network error. Try again.", true);
  } finally {
    readBtn.disabled = false;
  }
});

function money(n, currency) {
  const cur = currency && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    return n.toLocaleString("en-US", { style: "currency", currency: cur });
  } catch (_) {
    return "$" + n.toFixed(2);
  }
}

function renderReadout(json) {
  const d = json.data;
  const cur = d.currency;
  $("modelBadge").textContent = (MODELS.find((m) => m.id === json.model) || {}).label || json.model;
  $("latencyBadge").textContent = (json.latencyMs / 1000).toFixed(1) + "s";
  $("merchant").textContent = d.merchant || "Receipt";
  $("amtSubtotal").textContent = d.subtotal != null ? money(d.subtotal, cur) : "—";
  $("amtTax").textContent = d.tax != null ? money(d.tax, cur) : "—";
  $("amtTotal").textContent = d.total != null ? money(d.total, cur) : "—";

  const notes = [];
  if (d.subtotal == null && d.total == null) notes.push("No amounts detected — try a clearer photo.");
  if (d.tipAlready != null) notes.push("Heads up: a tip/gratuity of " + money(d.tipAlready, cur) + " is already on this receipt.");
  $("extractNote").textContent = notes.join(" ");

  readout.hidden = false;
  if (d.subtotal != null || d.total != null) {
    tipPanel.hidden = false;
    calc();
  } else {
    tipPanel.hidden = true;
  }
}

// ---------- Tip math ----------
let tipBase = "subtotal";
const baseToggle = $("baseToggle");
baseToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".toggle__btn");
  if (!btn) return;
  [...baseToggle.children].forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  tipBase = btn.dataset.base;
  calc();
});

const tipGrid = $("tipGrid");
const tipButtons = [...document.querySelectorAll(".tip-btn")];
const customTip = $("customTip");
tipGrid.addEventListener("click", (e) => {
  const btn = e.target.closest(".tip-btn");
  if (!btn) return;
  tipButtons.forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  customTip.value = "";
  calc();
});
customTip.addEventListener("input", () => {
  if (customTip.value !== "") tipButtons.forEach((b) => b.classList.remove("is-active"));
  calc();
});

function getTipPercent() {
  const custom = parseFloat(customTip.value);
  if (!Number.isNaN(custom) && custom >= 0) return custom;
  const active = tipButtons.find((b) => b.classList.contains("is-active"));
  return active ? parseFloat(active.dataset.tip) : 0;
}

const peopleInput = $("people");
function setPeople(n) { peopleInput.value = Math.max(n, 1); calc(); }
$("minus").addEventListener("click", () => setPeople((parseInt(peopleInput.value, 10) || 1) - 1));
$("plus").addEventListener("click", () => setPeople((parseInt(peopleInput.value, 10) || 1) + 1));
peopleInput.addEventListener("input", calc);

function calc() {
  if (!extracted) return;
  const cur = extracted.currency;
  const subtotal = extracted.subtotal;
  const tax = extracted.tax;
  const total = extracted.total;

  const billTotal = total != null ? total
    : (subtotal != null ? subtotal + (tax || 0) : 0);

  let baseValue = tipBase === "subtotal" ? subtotal : total;
  if (baseValue == null) baseValue = billTotal;

  const pct = getTipPercent();
  const people = Math.max(parseInt(peopleInput.value, 10) || 1, 1);

  const tip = baseValue * (pct / 100);
  const grand = billTotal + tip;
  const perPerson = grand / people;

  $("tipOut").textContent = money(tip, cur);
  $("grandOut").textContent = money(grand, cur);
  $("perPersonOut").textContent = money(perPerson, cur);
  $("peopleCount").textContent = people;
}
