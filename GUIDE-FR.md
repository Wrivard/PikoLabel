# Guide rapide — Piko Label Printer (GitHub → Vercel)

## Installation

1. **Décompresse** `Piko-Label-Printer-GitHub-Vercel.zip` : GitHub ne décompresse pas automatiquement les ZIP déposés.
2. Crée un dépôt privé `piko-label-printer` sur GitHub.
3. Ajoute **les fichiers décompressés à la racine** du dépôt, en conservant les dossiers `api/`, `lib/` et `public/` (GitHub Desktop est pratique pour cette étape).
4. Sur [vercel.com/new](https://vercel.com/new), importe ce dépôt. Choisis **Other** si demandé, racine `./`, aucune commande de build nécessaire.
5. Clique sur **Deploy**. L'application est accessible en mode démo avec son URL `.vercel.app`.

## Connexion eBay

Dans Vercel → Project → Settings → Environment Variables, ajoute :

- `APP_PASSWORD` — mot de passe fort de 12 caractères ou plus.
- `APP_SECRET` — valeur aléatoire stable d'au moins 32 caractères. Ne la change pas après avoir connecté eBay.
- `EBAY_CLIENT_ID` — App ID Production.
- `EBAY_CLIENT_SECRET` — Cert ID Production. **Ne le partage jamais.**
- `EBAY_RUNAME` — identifiant RuName OAuth fourni par eBay.
- `EBAY_ENVIRONMENT` — `production`.

Redéploie dans Vercel après les modifications. Dans eBay Developers → Sign-in Settings, configure :

- **Auth Accepted URL** : `https://TON-SITE.vercel.app/api/oauth/callback`
- **Auth Declined URL** : `https://TON-SITE.vercel.app/?ebay=denied`

Connecte-toi à l'app, puis va dans **Settings → Connect eBay**. La connexion est limitée à la lecture des commandes non expédiées.

## Impression

Coche les commandes puis clique **Prepare both** :

- **Packing slips :** PDF 8,5 × 11 po pour ta Canon.
- **Address labels :** PDF thermique réglable avec « Ship from / Ship to » côte à côte pour ta MUNBYN 130B.

**À savoir :** les deux PDF sont préparés ensemble, mais Android ne permet pas à un simple site de sélectionner silencieusement deux imprimantes différentes. Tu ouvres/imprimes les PDF séparément (et selon le modèle, la MUNBYN peut nécessiter son application). Les champs de noms d'imprimantes dans Settings servent de préférences pour une future version avec pont d'impression, **pas de routage automatique aujourd'hui**.

Les réglages sont conservés dans le navigateur de la tablette. La connexion eBay utilise un cookie chiffré : tu dois autoriser chaque appareil séparément.

Pour les détails et précautions de sécurité, consulte `README.md`.
