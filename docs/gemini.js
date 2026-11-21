"use strict";
/* Appels à l'API Gemini, directement depuis le navigateur.
   La clé est saisie dans « Réglages » et reste sur l'appareil (localStorage). */

const Gemini = (() => {
  const KEY_STORE = "optcg-coach-gemini";
  const DEFAULT_MODEL = "gemini-3.1-flash-lite";
  const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";

  function settings() {
    try { return Object.assign({ key: "", model: DEFAULT_MODEL }, JSON.parse(localStorage.getItem(KEY_STORE) || "{}")); }
    catch (_) { return { key: "", model: DEFAULT_MODEL }; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(KEY_STORE, JSON.stringify(s)); return true; } catch (_) { return false; }
  }

  async function call({ system, parts, schema, thinking = "LOW" }) {
    const { key, model } = settings();
    if (!key) throw new Error("Il manque la clé Gemini : ouvre ⚙️ Réglages pour la coller (une seule fois).");
    let res;
    try {
      res = await fetch(ENDPOINT + encodeURIComponent(model || DEFAULT_MODEL) + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            thinkingConfig: { thinkingLevel: thinking },
          },
        }),
      });
    } catch (_) {
      throw new Error("Pas de connexion internet (ou Gemini injoignable). Réessaie dans un instant.");
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* pas de JSON */ }
    if (!res.ok) {
      const msg = data?.error?.message || "";
      if (res.status === 400 && /API key/i.test(msg)) throw new Error("La clé Gemini n'est pas valide : vérifie-la dans ⚙️ Réglages.");
      if (res.status === 403) throw new Error("Clé Gemini refusée (restriction ou API non activée).");
      if (res.status === 404) throw new Error(`Modèle « ${model} » introuvable : choisis-en un autre dans ⚙️ Réglages.`);
      if (res.status === 429) throw new Error("Trop de demandes (ou quota atteint). Attends un peu et réessaie.");
      throw new Error(`Erreur Gemini (${res.status}) ${msg}`.trim());
    }
    if (data?.promptFeedback?.blockReason) throw new Error("Gemini a refusé cette demande. Réessaie avec une autre photo.");
    const cand = data?.candidates?.[0];
    if (cand?.finishReason === "MAX_TOKENS") throw new Error("Réponse coupée, réessaie.");
    const text = (cand?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
    if (!text) throw new Error("Réponse vide de Gemini, réessaie.");
    try { return JSON.parse(text); } catch (_) { throw new Error("Réponse illisible de Gemini, réessaie."); }
  }

  /* ---------------------------------------------------------------- Contexte du deck */
  function cardLine(c) {
    const p = [`${c.code} | ${c.nom} | ${c.categorie || "?"}`];
    if (c.cout != null) p.push(`coût ${c.cout}`);
    if (c.puissance != null) p.push(`puissance ${c.puissance}`);
    if (c.counter) p.push(`counter +${c.counter}`);
    if (c.types?.length) p.push("types: " + c.types.join(", "));
    return p.join(" | ");
  }
  function deckContext(deck) {
    const L = deck.leader;
    const lines = [`# Deck : ${deck.nom || ""}`, "", "## Leader", cardLine(L),
      `Effet officiel : ${L.effet_officiel || ""}`, `Effet simplifié : ${L.effet_simple || ""}`, "", "## Cartes du deck"];
    for (const c of deck.cartes) {
      lines.push(`- ${cardLine(c)} | x${c.quantite || 1}`);
      if (c.effet_officiel) lines.push(`  Effet officiel : ${c.effet_officiel}`);
      if (c.effet_simple) lines.push(`  Effet simplifié : ${c.effet_simple}`);
    }
    if (deck.combos?.length) {
      lines.push("", "## Combos du deck");
      for (const co of deck.combos) lines.push(`- ${co.titre} : ${co.explication} (quand : ${co.quand || "-"}) (cartes : ${(co.cartes || []).join(", ")})`);
    }
    if (deck.conseils_generaux?.length) lines.push("", "## Conseils généraux pour ce deck", ...deck.conseils_generaux.map((t) => `- ${t}`));
    return lines.join("\n");
  }

  /* ---------------------------------------------------------------- Reconnaissance de la main */
  const RECO_SCHEMA = {
    type: "object",
    properties: {
      cartes: {
        type: "array",
        items: {
          type: "object",
          properties: { code: { type: "string" }, certitude: { type: "string", enum: ["haute", "moyenne", "basse"] } },
          required: ["code", "certitude"],
        },
      },
      remarque: { type: "string" },
    },
    required: ["cartes", "remarque"],
  };

  async function recognize(blob, deck) {
    const b64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const candidates = [deck.leader, ...deck.cartes];
    const system =
      "Tu reconnais des cartes du jeu One Piece Card Game sur une photo prise par une tablette. " +
      "Les cartes sont posées à plat sur une table, parfois légèrement superposées. " +
      "Les cartes ne peuvent être QUE parmi la liste de candidats ci-dessous (le deck de la joueuse). " +
      "Pour chaque carte visible, renvoie son code. Si la même carte apparaît 2 fois, renvoie-la 2 fois. " +
      "Les cartes physiques sont en FRANÇAIS (les noms d'événements de la liste sont en anglais ; l'illustration " +
      "et le code restent identiques). Le moyen le plus sûr : lire le code imprimé en bas à droite (ex. OP12-031). " +
      "Sinon, utilise le nom du personnage, le coût (en haut à gauche), la puissance (en haut à droite) et l'illustration. " +
      "Ignore le leader et les cartes DON!! (elles ne font pas partie de la main). " +
      "N'invente aucune carte : si une carte est illisible, ne la mets pas et signale-le dans 'remarque' (en français, une phrase courte, sinon chaîne vide).\n\n" +
      "Candidats (code | nom | catégorie | coût | puissance | counter | types) :\n" + candidates.map(cardLine).join("\n");
    const res = await call({
      system,
      parts: [
        { text: "Quelles cartes de la liste vois-tu sur cette photo ?" },
        { inlineData: { mimeType: blob.type || "image/jpeg", data: b64 } },
      ],
      schema: RECO_SCHEMA,
      thinking: "LOW",
    });
    const valid = new Set(deck.cartes.map((c) => c.code));
    return { cartes: (res.cartes || []).filter((c) => valid.has(c.code)), remarque: res.remarque || "" };
  }

  /* ---------------------------------------------------------------- Conseil */
  const ADVICE_SCHEMA = {
    type: "object",
    properties: {
      petit_mot: { type: "string" },
      coups: {
        type: "array",
        items: {
          type: "object",
          properties: { action: { type: "string" }, pourquoi: { type: "string" }, cartes: { type: "array", items: { type: "string" } } },
          required: ["action", "pourquoi", "cartes"],
        },
      },
      a_retenir: { type: "string" },
    },
    required: ["petit_mot", "coups", "a_retenir"],
  };

  function describeState(s, deck) {
    const byCode = Object.fromEntries(deck.cartes.map((c) => [c.code, c]));
    const name = (code) => (byCode[code] ? `${byCode[code].nom} (${code})` : code);
    const perso = (p) => [p.code ? name(p.code) : "personnage",
      p.puissance != null ? `${p.puissance} de puissance` : null,
      p.don ? `${p.don} DON attachés` : null,
      p.epuise ? "épuisé" : "actif"].filter(Boolean).join(", ");
    return [
      "# Situation actuelle (c'est mon tour, phase principale)",
      s.tour ? `Tour n°${s.tour}${s.premier === true ? " (c'est moi qui ai commencé la partie)" : s.premier === false ? " (l'adversaire a commencé la partie)" : ""}` : null,
      `Ma main (${s.main.length} cartes) : ` + (s.main.map(name).join(", ") || "vide"),
      ...[...new Set(s.main)].filter((c) => byCode[c]?.effet_simple)
        .map((c) => `  - Effet de ${name(c)} (coût ${byCode[c].cout ?? "?"}) : ${byCode[c].effet_simple}`),
      `Mes DON!! disponibles (actifs) : ${s.don_dispo} sur ${s.don_total} DON en jeu`,
      s.don_leader ? `DON déjà attachés à mon leader : ${s.don_leader}` : null,
      `Mon leader : ${s.leader_epuise ? "épuisé (a déjà attaqué)" : "actif"}`,
      `Mes vies : ${s.mes_vies}`,
      "Mes personnages : " + (s.mes_persos.map(perso).join("; ") || "aucun"),
      `Vies de l'adversaire : ${s.vies_adv}`,
      "Personnages adverses : " + (s.persos_adv.map(perso).join("; ") || "aucun"),
    ].filter(Boolean).join("\n");
  }

  let rulesCache = null;
  async function rules() {
    if (rulesCache == null) {
      try { rulesCache = await (await fetch("regles.md")).text(); } catch (_) { rulesCache = ""; }
    }
    return rulesCache;
  }

  async function advice(state, deck) {
    const system =
      "Tu es « Bubulle », un petit poisson rose tout rond et adorable (avec un bandana vert, comme Zoro) qui apprend à une débutante à jouer au One Piece Card Game " +
      "avec SON deck. Tu parles français et tu la tutoies. Ton ton est mignon, chaleureux et enthousiaste, " +
      "comme une amie complice qui nage dans son équipe : tu la félicites pour ses bons choix, tu dédramatises " +
      "quand la situation est difficile, tu glisses 1 ou 2 emojis (🐟 💦 ⚔️ ✨ 💚…) mais sans en abuser. Tu as quelques tics de poisson : " +
      "un « blub ! » de temps en temps, une petite expression marine (« on garde le cap », « ça va faire des vagues ») — juste une touche, jamais au détriment de la clarté du conseil. " +
      "Tu n'es jamais condescendant ni moralisateur, et tu ne dis jamais « tu aurais dû ».\n" +
      "Pour qu'elle s'implique, laisse-lui une part de décision : quand c'est pertinent, pose-lui une petite " +
      "question dans un pourquoi (ex. « À ton avis, quel perso adverse est le plus menaçant ? »).\n" +
      "Ta tâche : à partir de la situation, propose 1 à 2 coups concrets (jusqu'à 4 pour un combo) à faire MAINTENANT, dans l'ordre. " +
      "Chaque coup : une action courte et un « pourquoi » court et pédagogique. " +
      "IMPORTANT : quand une carte a un effet où elle doit faire un choix (cible à épuiser/KO, DON à donner ou attacher, carte à défausser…), " +
      "l'action doit dire explicitement chaque choix, car elle oublie souvent ces étapes. " +
      "Ex. : « Joue Tashigi : épuise le Kid adverse, puis donne 3 DON épuisés à ton leader » " +
      "(les DON utilisés pour payer Tashigi sont épuisés, donc ils comptent ; ce sont des DON en plus, ils ne coûtent rien). " +
      "Si le combo avec le leader se déclenche, ajoute les étapes suivantes comme coups séparés (attaque du perso épuisé, activer l'effet du leader, attaque du leader adverse) : dans ce cas tu peux proposer jusqu'à 4 coups. " +
      "Respecte strictement le coût en DON disponibles : n'additionne jamais plus de DON que disponibles " +
      "(jouer des cartes + attacher des DON). Ne propose que des cartes présentes dans sa main ou sur le terrain. " +
      "Pense à : jouer les cartes qui combotent avec le leader, attacher des DON pour passer la puissance adverse, " +
      "garder des cartes counter / DON pour se défendre quand c'est utile, ne pas attaquer un personnage si viser le leader est mieux. " +
      "Dans 'cartes', liste les codes des cartes concernées. " +
      "'petit_mot' : une phrase d'accroche mignonne et encourageante adaptée à la situation (ex. « Blub ! Joli tirage, ton Zoro va pouvoir briller ⚔️ »).\n" +
      "'a_retenir' : une phrase courte, un principe général à retenir pour progresser, dit gentiment (ou chaîne vide si rien de neuf).\n\n" +
      "## Règles de base\n" + (await rules()) + "\n\n" + deckContext(deck);
    const mode = state.apprentissage
      ? "Mode apprentissage ACTIVÉ : explique un peu plus (2 phrases max par pourquoi), rappelle la règle utilisée."
      : "Mode apprentissage désactivé : sois très bref (une phrase courte par pourquoi).";
    const check =
      "Avant de répondre, vérifie : " +
      "1) Pour chaque carte que tu fais jouer, l'action décrit-elle son effet « Quand tu la joues » avec les choix précis " +
      "(quel perso adverse épuiser, donner 3 DON épuisés au leader…) ? " +
      "2) Si le leader reçoit 3 DON (Tashigi, Zoro 7), as-tu proposé le combo du leader (attaquer le perso épuisé, activer son effet, attaquer le leader adverse) ? " +
      "3) La puissance annoncée tient-elle compte de tous les DON attachés (+1000 par DON) ? " +
      "4) Le total de DON dépensés ne dépasse-t-il pas les DON disponibles ?";
    return call({ system, parts: [{ text: describeState(state, deck) + "\n\n" + mode + "\n\n" + check }], schema: ADVICE_SCHEMA, thinking: "MEDIUM" });
  }

  return { settings, saveSettings, recognize, advice, DEFAULT_MODEL };
})();
