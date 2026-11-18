"use strict";

/* ------------------------------------------------------------------ État */
const STORE_KEY = "optcg-coach-v1";
const DEFAULT_STATE = () => ({
  hand: [],               // codes (doublons possibles)
  donDispo: 0, donTotal: 0,
  mesVies: 5, viesAdv: 5, tour: 1,
  leaderEpuise: false, donLeader: 0,
  myBoard: [],            // {id, code, epuise, don}
  enemyBoard: [],         // {id, puissance, epuise}
  learn: true,
  premier: null,          // true = elle commence la partie
});
let state = loadState();
let deck = null;
let byCode = {};

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(DEFAULT_STATE(), JSON.parse(raw));
  } catch (_) { /* stockage indisponible */ }
  return DEFAULT_STATE();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
}
const uid = () => Math.random().toString(36).slice(2, 9);
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ------------------------------------------------------------------ Rendu des cartes */
function cardHTML(card, { badge = null, unsure = false, minus = false, caption = true, attrs = "", cls = "" } = {}) {
  const stats = [
    card.puissance != null ? `${card.puissance}` : null,
    card.counter ? `counter +${card.counter}` : null,
  ].filter(Boolean).join(" · ");
  const fallback = `
    <div class="card-fallback">
      <div class="cf-cost">${card.cout ?? "L"}</div>
      <div><div class="cf-name">${esc(card.nom)}</div><div class="cf-stats">${esc(card.categorie || "")}${stats ? " · " + esc(stats) : ""}</div></div>
    </div>`;
  const art = card.image
    ? `<img class="card-art" src="${esc(card.image)}" alt="${esc(card.nom)}" loading="lazy"
         onerror="this.outerHTML=this.nextElementSibling.innerHTML"><template>${fallback}</template>`
    : fallback;
  return `
    <button class="card ${cls}" type="button" ${attrs}>
      ${art}
      ${badge != null ? `<span class="badge ${unsure ? "unsure" : ""}">${badge}</span>` : ""}
      ${minus ? `<span class="minus" data-minus aria-label="Retirer">−</span>` : ""}
      ${caption ? `<span class="card-caption"><b>${esc(card.nom)}</b>${esc(short(card.effet_simple))}</span>` : ""}
    </button>`;
}
function thumb(card, cls = "thumb") {
  if (card?.image) return `<img class="${cls}" src="${esc(card.image)}" alt="${esc(card.nom)}" loading="lazy">`;
  return `<div class="${cls} thumb-fallback">${esc((card?.nom || "?").slice(0, 2))}</div>`;
}
function short(t) {
  if (!t || t.startsWith("À COMPLÉTER")) return "";
  return t.length > 70 ? t.slice(0, 68) + "…" : t;
}

/* ------------------------------------------------------------------ Rendu principal */
function render() {
  document.body.classList.toggle("learn", state.learn);
  $("#learn-toggle").checked = state.learn;

  // Main
  const counts = countCodes(state.hand);
  $("#hand-count").textContent = state.hand.length;
  $("#hand-empty").hidden = state.hand.length > 0;
  $("#hand").innerHTML = Object.entries(counts).map(([code, n]) => {
    const c = byCode[code];
    if (!c) return "";
    return cardHTML(c, { badge: n > 1 ? `×${n}` : null, attrs: `data-open="${esc(code)}"` });
  }).join("");

  // Compteurs
  for (const k of ["donDispo", "donTotal", "mesVies", "viesAdv", "tour"]) {
    const el = $(`#v-${k}`);
    if (el) el.textContent = state[k];
  }

  // Mon board
  const L = deck.leader;
  const fieldCard = ({ card, rested, don, toggle, donAttr, rmAttr, leader }) => `
    <div class="fcard ${rested ? "rested" : ""} ${leader ? "leader" : ""}" ${toggle} role="button" tabindex="0">
      <div class="fcard-slot">${thumb(card, "fcard-img")}</div>
      <span class="fpow">${(card.puissance || 0) + don * 1000}</span>
      ${don ? `<span class="fdon">+${don} DON</span>` : ""}
      <div class="fname">${leader ? "👑 " : ""}${esc(card.nom)}</div>
      <div class="fstate">${rested ? "😴 épuisé" : "✨ actif"}</div>
      <div class="factions">
        <button class="mini don" ${donAttr} title="Attacher un DON">+DON</button>
        ${rmAttr ? `<button class="mini" ${rmAttr} aria-label="Retirer">✕</button>` : ""}
      </div>
    </div>`;
  $("#my-board").innerHTML =
    fieldCard({ card: L, rested: state.leaderEpuise, don: state.donLeader, toggle: "data-toggle-leader", donAttr: "data-don-leader", leader: true }) +
    state.myBoard.map((p) => fieldCard({
      card: byCode[p.code] || { nom: "?", puissance: 0 }, rested: p.epuise, don: p.don,
      toggle: `data-toggle-mine="${p.id}"`, donAttr: `data-don-mine="${p.id}"`, rmAttr: `data-rm-mine="${p.id}"`,
    })).join("");

  // Board adverse
  $("#enemy-board").innerHTML = state.enemyBoard.length
    ? state.enemyBoard.map((p) => `
      <div class="fcard enemy ${p.epuise ? "rested" : ""}" data-toggle-enemy="${p.id}" role="button" tabindex="0">
        <div class="fcard-slot"><div class="fcard-img enemy-back">🏴‍☠️</div></div>
        <span class="fpow">${p.puissance}</span>
        <div class="fname">Perso adverse</div>
        <div class="fstate">${p.epuise ? "😴 épuisé" : "⚔️ actif"}</div>
        <div class="factions"><button class="mini" data-rm-enemy="${p.id}" aria-label="Retirer">✕</button></div>
      </div>`).join("")
    : `<span class="hint" style="margin:0;align-self:center">Aucun perso adverse pour l'instant 🌊</span>`;

  save();
}
function countCodes(list) {
  const out = {};
  for (const c of list) out[c] = (out[c] || 0) + 1;
  return out;
}

/* ------------------------------------------------------------------ Feuille modale */
function openSheet(html) {
  // Nouveau conteneur à chaque ouverture : les écouteurs des fenêtres précédentes disparaissent.
  const old = $("#sheet-body");
  const fresh = old.cloneNode(false);
  old.replaceWith(fresh);
  fresh.innerHTML = html;
  $("#sheet-backdrop").hidden = false;
  $("#sheet-backdrop").scrollTop = 0;
}
function closeSheet() { $("#sheet-backdrop").hidden = true; $("#sheet-body").innerHTML = ""; }
$("#sheet-close").addEventListener("click", closeSheet);
$("#sheet-backdrop").addEventListener("click", (e) => { if (e.target.id === "sheet-backdrop") closeSheet(); });

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ------------------------------------------------------------------ Fiche carte */
function combosFor(code) {
  return (deck.combos || []).filter((co) => (co.cartes || []).includes(code));
}
function openCard(code, { fromHand = true } = {}) {
  const c = byCode[code] || (deck.leader.code === code ? deck.leader : null);
  if (!c) return;
  const tags = [
    c.categorie, c.cout != null ? `Coût ${c.cout}` : null, c.puissance != null ? `Puissance ${c.puissance}` : null,
    c.counter ? `Counter +${c.counter}` : null, ...(c.types || []),
  ].filter(Boolean);
  const combos = combosFor(code).map((co) => `<div class="combo-note"><b>Combo : ${esc(co.titre)}</b><br>${esc(co.explication)}</div>`).join("");
  const simple = c.effet_simple && !c.effet_simple.startsWith("À COMPLÉTER") ? c.effet_simple : "Effet simplifié pas encore écrit.";
  const canPlay = fromHand && c.cout != null;
  openSheet(`
    <h2>${esc(c.nom)} <small class="hint" style="margin:0">${esc(c.code)}</small></h2>
    <div class="detail">
      <div>${cardHTML(c, { caption: false })}</div>
      <div>
        <p class="detail-simple">${esc(simple)}</p>
        <div class="detail-meta">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        ${state.learn && c.counter ? `<p class="hint">Pendant le tour adverse, tu peux défausser cette carte pour donner +${c.counter} à ton leader ou un perso attaqué.</p>` : ""}
        ${combos}
        ${c.effet_officiel && !c.effet_officiel.startsWith("À COMPLÉTER") ? `<p class="detail-official"><b>Texte officiel :</b> ${esc(c.effet_officiel)}</p>` : ""}
      </div>
    </div>
    ${fromHand ? `
    <div class="sheet-actions">
      <button class="btn danger" id="act-remove">Retirer de ma main</button>
      ${canPlay ? `<button class="btn primary" id="act-play">Je la joue (−${c.cout} DON)</button>` : ""}
    </div>` : ""}
  `);
  $("#act-remove")?.addEventListener("click", () => { removeFromHand(code); closeSheet(); render(); });
  $("#act-play")?.addEventListener("click", () => {
    if (c.cout > state.donDispo) {
      toast(`Pas assez de DON : il en faut ${c.cout}, tu en as ${state.donDispo}.`);
      return;
    }
    state.donDispo -= c.cout;
    removeFromHand(code);
    if (c.categorie === "Personnage") {
      if (state.myBoard.length >= 5) toast("Attention : maximum 5 persos sur le terrain.");
      state.myBoard.push({ id: uid(), code, epuise: false, don: 0 });
    }
    closeSheet(); render();
    toast(`${c.nom} entre en jeu ! ✨`);
  });
}
function removeFromHand(code) {
  const i = state.hand.indexOf(code);
  if (i >= 0) state.hand.splice(i, 1);
}

/* ------------------------------------------------------------------ Choix manuel de la main */
function openManual(initial = state.hand, title = "Choisis les cartes de ta main") {
  let draft = [...initial];
  const draw = () => {
    const counts = countCodes(draft);
    $("#manual-grid").innerHTML = deck.cartes.map((c) => {
      const n = counts[c.code] || 0;
      return cardHTML(c, { badge: n || null, minus: n > 0, attrs: `data-pick="${esc(c.code)}"`, cls: n ? "selected" : "" });
    }).join("");
    $("#manual-total").textContent = draft.length;
  };
  openSheet(`
    <h2>${esc(title)} <span class="count" id="manual-total">0</span></h2>
    <p class="hint">Touche une carte pour l'ajouter. Touche « − » pour en retirer une.</p>
    <div class="cards-grid" id="manual-grid"></div>
    <div class="sheet-actions">
      <button class="btn" id="manual-clear">Tout vider</button>
      <button class="btn primary" id="manual-ok">Valider ma main</button>
    </div>`);
  draw();
  $("#manual-grid").addEventListener("click", (e) => {
    const cardEl = e.target.closest("[data-pick]");
    if (!cardEl) return;
    const code = cardEl.dataset.pick;
    if (e.target.closest("[data-minus]")) {
      const i = draft.indexOf(code);
      if (i >= 0) draft.splice(i, 1);
    } else {
      const max = byCode[code]?.quantite || 4;
      if (draft.filter((x) => x === code).length >= max) { toast(`Tu n'as que ${max} exemplaires de cette carte.`); return; }
      draft.push(code);
    }
    draw();
  });
  $("#manual-clear").addEventListener("click", () => { draft = []; draw(); });
  $("#manual-ok").addEventListener("click", () => { state.hand = draft; closeSheet(); render(); });
}

/* ------------------------------------------------------------------ Photo */
$("#btn-photo").addEventListener("click", () => $("#photo-input").click());
$("#photo-input").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  let blob, url;
  try {
    blob = await downscale(file, 1600);
    url = URL.createObjectURL(blob);
  } catch (_) {
    toast("Impossible de lire la photo.");
    return;
  }
  openSheet(`
    <h2>Je regarde ta main… 👀</h2>
    <img class="preview" src="${url}" alt="Photo de ta main">
    <div class="loading"><span class="spinner"></span> Reconnaissance des cartes (quelques secondes)</div>`);
  try {
    const res = await Gemini.recognize(blob, deck);
    showRecognition(res, url);
  } catch (err) {
    openSheet(`
      <h2>Oups 🙈</h2>
      <p class="error">${esc(err.message)}</p>
      <div class="sheet-actions">
        <button class="btn" id="retry-manual">Choisir à la main</button>
        <button class="btn primary" id="retry-photo">Reprendre une photo</button>
      </div>`);
    $("#retry-photo").addEventListener("click", () => { closeSheet(); $("#photo-input").click(); });
    $("#retry-manual").addEventListener("click", () => openManual());
  }
});

function showRecognition(res, url) {
  let found = res.cartes.map((c) => ({ code: c.code, unsure: c.certitude !== "haute" }));
  const draw = () => {
    $("#reco-grid").innerHTML = found.length
      ? found.map((f, i) => cardHTML(byCode[f.code], {
          badge: f.unsure ? "?" : null, unsure: f.unsure, attrs: `data-reco="${i}"`,
        })).join("")
      : `<p class="empty">Aucune carte reconnue.</p>`;
    $("#reco-count").textContent = found.length;
  };
  openSheet(`
    <h2>J'ai vu <span class="count" id="reco-count">0</span> cartes ✨</h2>
    <img class="preview" src="${url}" alt="Photo de ta main">
    ${res.remarque ? `<p class="hint">${esc(res.remarque)}</p>` : ""}
    <p class="hint">Touche une carte qui n'est pas dans ta main pour l'enlever. Les cartes avec « ? » sont à vérifier.</p>
    <div class="cards-grid" id="reco-grid"></div>
    <div class="sheet-actions">
      <button class="btn" id="reco-fix">Corriger / ajouter</button>
      <button class="btn primary" id="reco-ok">C'est bon ! 💚</button>
    </div>`);
  draw();
  $("#reco-grid").addEventListener("click", (e) => {
    const el = e.target.closest("[data-reco]");
    if (!el) return;
    found.splice(Number(el.dataset.reco), 1);
    draw();
  });
  $("#reco-ok").addEventListener("click", () => { state.hand = found.map((f) => f.code); closeSheet(); render(); });
  $("#reco-fix").addEventListener("click", () => openManual(found.map((f) => f.code), "Corrige ta main"));
}

function downscale(file, maxSide) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(src);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.85);
    };
    img.onerror = reject;
    img.src = src;
  });
}

/* ------------------------------------------------------------------ Conseil */
$("#btn-advice").addEventListener("click", async () => {
  const box = $("#advice");
  const btn = $("#btn-advice");
  if (!state.hand.length && !state.myBoard.length) {
    box.innerHTML = `<div class="bubble-row"><img class="fish-avatar talk" src="poisson.svg" alt="Bubulle"><div class="bubble">Blub ! Montre-moi d'abord ta main (photo ou choix à la main) et tes DON, et je t'aide ! 💚</div></div>`;
    return;
  }
  btn.disabled = true;
  box.innerHTML = `<div class="loading"><img class="fish-avatar swim" src="poisson.svg" alt=""> Bubulle réfléchit très fort… blub blub 🐟</div>`;
  try {
    const res = await Gemini.advice({
        main: state.hand, premier: state.premier,
        don_dispo: state.donDispo, don_total: state.donTotal, don_leader: state.donLeader,
        mes_vies: state.mesVies, vies_adv: state.viesAdv, tour: state.tour,
        leader_epuise: state.leaderEpuise,
        mes_persos: state.myBoard.map((p) => ({ code: p.code, epuise: p.epuise, don: p.don, puissance: (byCode[p.code]?.puissance || 0) + p.don * 1000 })),
        persos_adv: state.enemyBoard.map((p) => ({ puissance: p.puissance, epuise: p.epuise })),
        apprentissage: state.learn,
      }, deck);
    const cardOf = (code) => byCode[code] || (deck.leader.code === code ? deck.leader : null);
    box.innerHTML =
      (res.petit_mot ? `
        <div class="bubble-row">
          <img class="fish-avatar talk" src="poisson.svg" alt="Bubulle">
          <div class="bubble">${esc(res.petit_mot)}</div>
        </div>` : "") +
      res.coups.map((m, i) => {
        const cards = (m.cartes || []).map(cardOf).filter(Boolean);
        return `
        <div class="move">
          <span class="move-num">${i + 1}</span>
          <div class="move-body">
            <div class="move-action">${esc(m.action)}</div>
            <div class="move-why">${esc(m.pourquoi)}</div>
            ${cards.length ? `<div class="move-cards">${cards.map((c) =>
              `<button class="move-card" data-move-card="${esc(c.code)}">${thumb(c)}</button>`).join("")}</div>` : ""}
          </div>
        </div>`;
      }).join("") +
      (res.a_retenir ? `<div class="remember">💡 <b>À retenir :</b> ${esc(res.a_retenir)}</div>` : "") +
      `<p class="hint advice-note">C'est toi la capitaine : tu peux suivre le conseil… ou tenter ton idée ! 🏴‍☠️</p>`;
  } catch (err) {
    box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    if (/Réglages/.test(err.message)) openSettings();
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------------------------------------------ Réglages (clé Gemini) */
function openSettings() {
  const s = Gemini.settings();
  const models = [
    ["gemini-3.1-flash-lite", "3.1 Flash-Lite — pas cher, conseillé"],
    ["gemini-2.5-flash-lite", "2.5 Flash-Lite — encore moins cher, moins fiable"],
    ["gemini-3.8-flash", "3.8 Flash — plus malin, plus cher"],
  ];
  if (!models.some(([id]) => id === s.model)) models.push([s.model, s.model]);
  openSheet(`
    <h2>⚙️ Réglages</h2>
    <label class="field-label" for="set-key">Clé API Gemini</label>
    <input class="text-input" id="set-key" type="password" autocomplete="off" spellcheck="false"
      placeholder="Colle la clé ici (commence par AIza…)" value="${esc(s.key)}">
    <p class="hint">La clé reste uniquement sur cet appareil. Elle se crée gratuitement sur aistudio.google.com → « Get API key ».</p>
    <label class="field-label" for="set-model">Modèle</label>
    <select class="text-input" id="set-model">${models.map(([id, label]) =>
      `<option value="${esc(id)}" ${id === s.model ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>
    <div class="sheet-actions">
      <button class="btn danger" id="set-clear">Effacer la clé</button>
      <button class="btn primary" id="set-ok">Enregistrer 💚</button>
    </div>`);
  $("#set-ok").addEventListener("click", () => {
    const key = $("#set-key").value.trim();
    Gemini.saveSettings({ key, model: $("#set-model").value });
    closeSheet();
    toast(key ? "C'est noté ! Bubulle est prêt 🐟" : "Clé vide : les conseils ne marcheront pas.");
  });
  $("#set-clear").addEventListener("click", () => { Gemini.saveSettings({ key: "", model: $("#set-model").value }); closeSheet(); toast("Clé effacée."); });
}
$("#btn-settings").addEventListener("click", openSettings);

/* ------------------------------------------------------------------ Terrain */
const LIMITS = { donDispo: [0, 10], mesVies: [0, 10], viesAdv: [0, 10], tour: [1, 99] };
document.addEventListener("click", (e) => {
  const inc = e.target.closest("[data-inc]")?.dataset.inc;
  const dec = e.target.closest("[data-dec]")?.dataset.dec;
  const k = inc || dec;
  if (!k) return;
  const [lo, hi] = LIMITS[k];
  state[k] = clamp(state[k] + (inc ? 1 : -1), lo, hi);
  if (k === "donDispo" && state.donDispo > state.donTotal) state.donTotal = state.donDispo;
  render();
});

// Qui commence ? (le 1er joueur ne reçoit qu'1 DON et ne pioche pas à son tout premier tour)
function askWhoStarts(then) {
  openSheet(`
    <h2>Qui commence la partie ? 🎲</h2>
    <p class="hint">Celui qui commence ne pioche pas et ne reçoit qu'1 DON à son premier tour. L'autre pioche et reçoit 2 DON.</p>
    <div class="sheet-actions">
      <button class="btn" data-starter="adv">🏴‍☠️ L'adversaire</button>
      <button class="btn primary" data-starter="moi">💚 C'est moi !</button>
    </div>`);
  $("#sheet-body").addEventListener("click", (e) => {
    const who = e.target.closest("[data-starter]")?.dataset.starter;
    if (!who) return;
    state.premier = who === "moi";
    closeSheet();
    then?.();
  });
}

function newTurn() {
  const first = state.donTotal === 0;
  const gain = first && state.premier ? 1 : 2;
  state.donTotal = clamp(state.donTotal + gain, 0, 10);
  state.donDispo = state.donTotal;
  if (!first) state.tour += 1;
  state.leaderEpuise = false;
  state.donLeader = 0;
  state.myBoard.forEach((p) => { p.epuise = false; p.don = 0; });
  state.enemyBoard.forEach((p) => { p.epuise = false; });
  render();
  toast(first && state.premier
    ? `Tour 1 : 1 seul DON car tu commences, et pas de pioche ce tour-ci 😉`
    : `Tour ${state.tour} : ${state.donDispo} DON prêts ! N'oublie pas de piocher 🃏`);
  $("#advice").innerHTML = "";
}

$("#btn-new-turn").addEventListener("click", () => {
  if (state.donTotal === 0 && state.premier == null) askWhoStarts(newTurn);
  else newTurn();
});

function attachDon(target) {
  if (state.donDispo <= 0) { toast("Oups, plus de DON disponibles 🙈"); return false; }
  state.donDispo -= 1;
  target();
  return true;
}

$("#my-board").addEventListener("click", (e) => {
  if (e.target.closest("[data-don-leader]")) { attachDon(() => state.donLeader++); render(); return; }
  const donMine = e.target.closest("[data-don-mine]")?.dataset.donMine;
  if (donMine) { const p = state.myBoard.find((x) => x.id === donMine); attachDon(() => p.don++); render(); return; }
  const rm = e.target.closest("[data-rm-mine]")?.dataset.rmMine;
  if (rm) { state.myBoard = state.myBoard.filter((p) => p.id !== rm); render(); return; }
  if (e.target.closest("[data-toggle-leader]")) { state.leaderEpuise = !state.leaderEpuise; render(); return; }
  const t = e.target.closest("[data-toggle-mine]")?.dataset.toggleMine;
  if (t) { const p = state.myBoard.find((x) => x.id === t); p.epuise = !p.epuise; render(); }
});

$("#enemy-board").addEventListener("click", (e) => {
  const rm = e.target.closest("[data-rm-enemy]")?.dataset.rmEnemy;
  if (rm) { state.enemyBoard = state.enemyBoard.filter((p) => p.id !== rm); render(); return; }
  const t = e.target.closest("[data-toggle-enemy]")?.dataset.toggleEnemy;
  if (t) { const p = state.enemyBoard.find((x) => x.id === t); p.epuise = !p.epuise; render(); }
});

$("#btn-add-mine").addEventListener("click", () => {
  const persos = deck.cartes.filter((c) => c.categorie === "Personnage");
  openSheet(`
    <h2>Quel perso as-tu sur le terrain ?</h2>
    <p class="hint">Pour un perso que tu viens de jouer depuis ta main, utilise plutôt « Je la joue » sur sa fiche.</p>
    <div class="cards-grid" id="pick-mine">${persos.map((c) => cardHTML(c, { attrs: `data-add-mine="${esc(c.code)}"` })).join("")}</div>`);
  $("#pick-mine").addEventListener("click", (e) => {
    const code = e.target.closest("[data-add-mine]")?.dataset.addMine;
    if (!code) return;
    state.myBoard.push({ id: uid(), code, epuise: false, don: 0 });
    closeSheet(); render();
  });
});

$("#btn-add-enemy").addEventListener("click", () => {
  const powers = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
  openSheet(`
    <h2>Puissance du perso adverse</h2>
    <p class="hint">Regarde le chiffre en haut à droite de sa carte (+1000 par DON attaché).</p>
    <div class="power-grid" id="pick-power">${powers.map((p) => `<button class="btn" data-pow="${p}">${p}</button>`).join("")}</div>`);
  $("#pick-power").addEventListener("click", (e) => {
    const p = e.target.closest("[data-pow]")?.dataset.pow;
    if (!p) return;
    state.enemyBoard.push({ id: uid(), puissance: Number(p), epuise: false });
    closeSheet(); render();
  });
});

/* ------------------------------------------------------------------ Divers */
$("#advice").addEventListener("click", (e) => {
  const code = e.target.closest("[data-move-card]")?.dataset.moveCard;
  if (code) openCard(code, { fromHand: state.hand.includes(code) });
});
$("#hand").addEventListener("click", (e) => {
  const code = e.target.closest("[data-open]")?.dataset.open;
  if (code) openCard(code);
});
$("#btn-manual").addEventListener("click", () => openManual());
$("#learn-toggle").addEventListener("change", (e) => { state.learn = e.target.checked; render(); });

$("#btn-new-game").addEventListener("click", () => {
  openSheet(`
    <h2>Nouvelle partie ?</h2>
    <p>La main, les DON, les vies et le terrain seront remis à zéro.</p>
    <div class="sheet-actions">
      <button class="btn" id="ng-cancel">Annuler</button>
      <button class="btn primary" id="ng-ok">C'est parti</button>
    </div>`);
  $("#ng-cancel").addEventListener("click", closeSheet);
  $("#ng-ok").addEventListener("click", () => {
    const learn = state.learn;
    state = DEFAULT_STATE();
    state.learn = learn;
    state.mesVies = deck.leader.vie || 5;
    $("#advice").innerHTML = "";
    render();
    askWhoStarts(() => {
      render();
      toast("Nouvelle aventure ! Pioche 5 cartes, puis montre-moi ta main 📷");
    });
  });
});

$("#btn-combos").addEventListener("click", () => {
  const combos = deck.combos || [];
  openSheet(`
    <h2>Combos de ton deck</h2>
    ${combos.length ? combos.map((co) => `
      <div class="combo">
        <h3>${esc(co.titre)}</h3>
        <div>${esc(co.explication)}</div>
        ${co.quand ? `<div class="when">Quand : ${esc(co.quand)}</div>` : ""}
        <div class="combo-cards">${(co.cartes || []).map((code) => {
          const c = byCode[code] || (deck.leader.code === code ? deck.leader : null);
          return c ? cardHTML(c, { caption: false, attrs: `data-combo-card="${esc(code)}"` }) : "";
        }).join("")}</div>
      </div>`).join("") : `<p class="empty">Pas encore de combos dans deck.json.</p>`}
    ${(deck.conseils_generaux || []).length ? `<h2 style="margin-top:16px">Conseils</h2><ul>${deck.conseils_generaux.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}`);
  $("#sheet-body").addEventListener("click", (e) => {
    const code = e.target.closest("[data-combo-card]")?.dataset.comboCard;
    if (code) openCard(code, { fromHand: false });
  });
});

/* ------------------------------------------------------------------ Démarrage */
(async function init() {
  try {
    const r = await fetch("deck.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(`Erreur ${r.status}`);
    deck = await r.json();
  } catch (err) {
    document.querySelector(".layout").innerHTML = `<p class="error">Impossible de charger le deck : ${esc(err.message)}</p>`;
    return;
  }
  byCode = Object.fromEntries(deck.cartes.map((c) => [c.code, c]));
  const stars = ["OP12-031", "OP16-035", "EB02-019"].map((k) => byCode[k]).filter(Boolean);
  $("#empty-fan").innerHTML = (stars.length ? stars : deck.cartes.slice(0, 3)).map((c) => thumb(c, "fan-card")).join("");
  state.hand = state.hand.filter((c) => byCode[c]);
  state.myBoard = state.myBoard.filter((p) => byCode[p.code]);
  render();
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
