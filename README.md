# Coach OPTCG 🐟

Assistant de jeu One Piece TCG pour tablette, en français, pour un deck Zoro vert (leader OP12-020).
Bubulle, le poisson coach, aide à lire la main (par photo), explique les cartes simplement et propose
quoi jouer, avec un ton mignon et encourageant.

Site statique (GitHub Pages) : la page appelle directement l'API Gemini depuis la tablette.

## Utilisation sur la tablette

1. Ouvrir le site dans Chrome, puis menu ⋮ → « Ajouter à l'écran d'accueil ».
2. Toucher ⚙️ et coller une clé API Gemini (créée sur aistudio.google.com → « Get API key »).
   La clé reste **uniquement sur l'appareil** (stockage du navigateur) ; elle n'est jamais dans ce dépôt.
3. Modèle par défaut : `gemini-3.1-flash-lite` (environ 0,3 centime par photo ou conseil).

### Protéger la clé (conseillé)

Dans la console Google Cloud → Identifiants → la clé API :
- **Restrictions d'application** : « Sites web (référents HTTP) » → `https://<ton-compte>.github.io/*`
- **Restrictions d'API** : uniquement « Generative Language API »
- Et un plafond de budget dans la facturation.

## Développement local

```powershell
python -m http.server 8123 --directory docs
```
puis ouvrir http://localhost:8123.

## Contenu

- `docs/` : le site (HTML/CSS/JS), `deck.json` (cartes, effets simplifiés, combos), `regles.md`, images des cartes.
- `tools/build_deck.py` : créer un squelette de deck depuis une decklist (`squelette`) et générer les effets
  simplifiés avec Gemini (`simplifier`, clé dans la variable `GEMINI_API_KEY`).

Données cartes : optcgapi.com. Visuels des cartes © Bandai / Eiichiro Oda (images d'aperçu officielles « SAMPLE »).
Projet perso non officiel.
