"""Outils pour préparer docs/deck.json.

1) Créer le squelette depuis une decklist texte (une ligne par carte, ex. « 4xOP12-045 » ou « 4 OP12-045 ») :
       python tools/build_deck.py squelette decklist.txt
   -> écrit docs/deck.json avec une entrée par carte unique (nom, coût, effets à compléter).
      La première ligne « 1xOPxx-xxx » d'un leader peut être marquée « leader: OPxx-xxx ».

2) Une fois les effets officiels remplis (champ effet_officiel), générer les effets simplifiés FR :
       $env:GEMINI_API_KEY="AIza..." ; python tools/build_deck.py simplifier
   -> remplit effet_simple pour chaque carte où il est vide ou commence par « À COMPLÉTER ».
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DECK = ROOT / "docs" / "deck.json"
LINE = re.compile(r"^\s*(\d+)\s*[xX]?\s*([A-Z]{2,3}\d{0,2}-\d{3})\s*$")
LEADER = re.compile(r"^\s*leader\s*:\s*([A-Z]{2,3}\d{0,2}-\d{3})\s*$", re.I)


def squelette(path: str) -> None:
    leader_code, cards = None, []
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        if m := LEADER.match(raw):
            leader_code = m.group(1)
        elif m := LINE.match(raw):
            cards.append((int(m.group(1)), m.group(2)))
        elif raw.strip():
            print(f"Ligne ignorée : {raw!r}")
    if leader_code is None and cards and cards[0][0] == 1:
        leader_code = cards.pop(0)[1]
    total = sum(q for q, _ in cards)
    print(f"Leader : {leader_code} — {len(cards)} cartes uniques, {total} cartes au total")

    old = json.loads(DECK.read_text(encoding="utf-8")) if DECK.exists() else {}
    known = {c["code"]: c for c in old.get("cartes", [])}

    def entry(code, q):
        base = known.get(code, {})
        return {
            "code": code, "nom": base.get("nom", "À COMPLÉTER"), "categorie": base.get("categorie", "Personnage"),
            "couleur": base.get("couleur", "Vert"), "cout": base.get("cout"), "puissance": base.get("puissance"),
            "counter": base.get("counter", 0), "types": base.get("types", []), "quantite": q,
            "effet_officiel": base.get("effet_officiel", ""), "effet_simple": base.get("effet_simple", "À COMPLÉTER"),
            "image": f"images/{code}.png",
        }

    deck = {
        "nom": old.get("nom", "Mon deck"),
        "leader": old.get("leader", {}) | {"code": leader_code, "image": f"images/{leader_code}.png"},
        "cartes": [entry(code, q) for q, code in cards],
        "combos": old.get("combos", []),
        "conseils_generaux": old.get("conseils_generaux", []),
    }
    DECK.write_text(json.dumps(deck, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Écrit : {DECK}")


def simplifier() -> None:
    import os
    import urllib.request

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("Définis d'abord la variable GEMINI_API_KEY.")
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent"
    deck = json.loads(DECK.read_text(encoding="utf-8"))
    for c in [deck["leader"]] + deck["cartes"]:
        if not c.get("effet_officiel") or c["effet_officiel"].startswith("À COMPLÉTER"):
            continue
        if c.get("effet_simple") and not c["effet_simple"].startswith("À COMPLÉTER"):
            continue
        body = {
            "systemInstruction": {"parts": [{"text": (
                "Tu reformules l'effet d'une carte One Piece Card Game pour une débutante, en français, "
                "en UNE phrase simple au tutoiement, qui commence par le moment où l'effet s'active "
                "(ex. « Quand tu la joues : regarde 5 cartes, prends un Zoro »). Réponds uniquement avec la phrase.")}]},
            "contents": [{"role": "user", "parts": [{"text": f"Carte : {c['nom']} ({c['code']})\nEffet officiel : {c['effet_officiel']}"}]}],
        }
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "x-goog-api-key": key})
        data = json.load(urllib.request.urlopen(req, timeout=60))
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        txt = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
        if txt:
            c["effet_simple"] = txt
            print(f"{c['code']} {c['nom']} -> {txt}")
    DECK.write_text(json.dumps(deck, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "squelette":
        squelette(sys.argv[2])
    elif len(sys.argv) >= 2 and sys.argv[1] == "simplifier":
        simplifier()
    else:
        print(__doc__)
