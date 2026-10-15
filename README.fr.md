<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Textus" width="120" height="120" />
</p>

<h1 align="center">Textus</h1>

<p align="center">
  <strong>L’éditeur Markdown nouvelle génération.</strong><br>
  Vous tenez la plume. L’IA prépare l’encre.
</p>

<p align="center">
  <a href="https://textus.catvinci.com"><strong>Site web</strong></a> ·
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><strong>Télécharger</strong></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.zh-Hant.md">繁體中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.es.md">Español</a> ·
  Français ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.ru.md">Русский</a> ·
  <a href="./README.pt.md">Português</a>
</p>

<p align="center">
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><img alt="version" src="https://img.shields.io/github/v/release/CatVinci-Studio/Textus"></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-yellow"></a>
</p>

<p align="center">
  <img src="docs/images/readme/fr/hero.png" alt="Textus avec Hamlet ouvert. À côté, Textus AI propose une modification avec son explication, phrase par phrase, et épingle un commentaire de relecture sur une ligne." width="860" />
</p>

## Écriture

### Tel écran, tel écrit

Le Markdown se met en forme à mesure que vous écrivez. Survolez une ligne pour afficher sa syntaxe.

### Formules, tableaux, diagrammes

Les formules s’affichent pendant la frappe, les tableaux s’alignent tout seuls, et quelques lignes de texte suffisent pour un diagramme.

### Votre style d’écriture ? À vous de voir

Quatre modes d’écriture et le thème de votre choix, thèmes Typora compris.

- **Mode zen**: tout s’efface, sauf vos mots.
- **Mode machine à écrire**: la ligne en cours reste toujours à la même hauteur.
- **Vue partagée**: le Markdown d’un côté, la page mise en forme de l’autre.
- **Mode source**: tout le document en Markdown brut.

<p align="center">
  <img src="docs/images/readme/fr/split.png" alt="Vue partagée" width="49%" />
  <img src="docs/images/readme/fr/zen.png" alt="Mode zen" width="49%" />
</p>

### Prêt à partager

Exportez en PDF, Word, HTML et plus encore.

## Textus AI

**L’IA propose. Vous décidez.** Textus AI vous accompagne à chaque étape. Chaque mot reste le vôtre.

- **Complétion**: Marquez une pause : la suite s’affiche en gris. Tab pour l’accepter.
- **Écriture assistée**: Chaque modification arrive sous forme de proposition, avec son explication. Acceptez-la en entier, ou phrase par phrase.
- **Vérification grammaticale**: Coquilles et fautes de grammaire sont signalées à mesure que vous écrivez, selon vos conventions d’écriture. Alt+Entrée pour corriger.
- **Relecture**: Des commentaires épinglés aux passages concernés. Des remarques, pas de réécriture.
- **Compétences intégrées**: Resserrer, relire, traduire, changer de ton… Il suffit de taper /.
- **Elle vous connaît**: Elle apprend votre style, retient vos personnages et vos lieux, et suit vos instructions d’écriture.

**L’IA de votre choix**: Connectez-vous avec ChatGPT ou Claude, ajoutez une clé d’API, ou utilisez un modèle en local, sur votre ordinateur.

OpenAI · Anthropic · Google Gemini · DeepSeek · xAI · Mistral · Groq · OpenRouter · Kimi · GLM · Qwen · Ollama · Tout service compatible OpenAI

## Confidentialité

Ce que vous écrivez vous appartient. Textus est fait pour que cela ne change pas, et son code est ouvert : chacun peut le vérifier.

- **Sur votre appareil**: Vos documents sont de simples fichiers Markdown, rangés où vous le souhaitez.
- **Clés gardées en local**: Les clés d’API et les connexions restent uniquement sur votre ordinateur.
- **Directement au fournisseur**: Les requêtes d’IA partent de votre appareil, droit vers le fournisseur choisi.
- **Sans compte**: Téléchargez, écrivez. Aucune inscription.
- **Aucun pistage**: Ni statistiques, ni télémétrie, ni publicité.
- **Open source**: Sous licence MIT et public, ligne par ligne : chacun peut tout vérifier.

Avec un modèle local via Ollama, vos mots ne quittent jamais votre ordinateur.

## Installation

macOS (Apple Silicon) avec [Homebrew](https://brew.sh) :

```sh
brew install --cask catvinci-studio/tap/textus
```

Arch Linux avec le dépôt pacman signé [`[catvinci]`](https://github.com/CatVinci-Studio/arch-repo) (une seule fois ; ensuite `sudo pacman -Syu` garde Textus à jour) :

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/CatVinci-Studio/arch-repo/main/install.sh) textus-bin
```

Ou téléchargez un installateur depuis [Releases](https://github.com/CatVinci-Studio/Textus/releases/latest) :

| Plateforme            | Installateur                                                               |
| --------------------- | -------------------------------------------------------------------------- |
| macOS (Apple Silicon) | `Textus_X.Y.Z_aarch64.dmg`                                                 |
| Windows               | `Textus_X.Y.Z_x64-setup.exe`                                               |
| Linux                 | `Textus_X.Y.Z_amd64.AppImage` · `_amd64.deb` · `Textus-X.Y.Z-1.x86_64.rpm` |

## Prise en main

1. Lancez Textus. Il s’ouvre sur un brouillon vierge ; un fichier n’est nécessaire qu’à l’enregistrement.
2. Ouvrez **Réglages → Textus AI**, choisissez un fournisseur, puis connectez-vous ou collez une clé dans **Authentification**.
3. Commencez à écrire. Quand vous marquez une pause, la suite apparaît en gris ; Tab l’accepte.
4. Ouvrez le Panneau IA avec le bouton de discussion de la barre de fenêtre. **Aide → Guide des fonctions IA** présente le reste.

| Action                               | Raccourci                           |
| ------------------------------------ | ----------------------------------- |
| Panneau IA                           | Ctrl/⌘+Shift+L                      |
| Question rapide                      | Ctrl/⌘+Shift+K                      |
| Suggérer une complétion              | Ctrl/⌘+Shift+Space                  |
| Vérifier la grammaire                | Ctrl/⌘+Shift+G                      |
| Accepter une modification en attente | Ctrl/⌘+Enter                        |
| Vue partagée                         | Ctrl/⌘+Shift+E                      |
| Mode zen                             | Ctrl/⌘+Shift+J (Échap pour quitter) |
| Mode source                          | Ctrl/⌘+/                            |

Tous se modifient dans **Réglages → Raccourcis**.

## Compiler depuis les sources

```bash
git clone https://github.com/CatVinci-Studio/Textus.git
cd Textus
npm install

npm run tauri dev     # full Tauri app (Rust shell + Vite renderer)
npm run tauri build   # bundle .dmg / -setup.exe (NSIS) / .AppImage / .deb / .rpm
npm run build         # frontend only: type-check (tsc) + vite build
```

Il faut [Node.js](https://nodejs.org) 22 ou plus, [Rust](https://rustup.rs) (stable) et les outils de compilation de chaque plateforme (Xcode CLT sur macOS ; `libwebkit2gtk-4.1-dev`/`libappindicator3-dev`/`librsvg2-dev`/`patchelf` sur Linux ; MSVC Build Tools sur Windows).

## Contribuer

[CONTRIBUTING.md](CONTRIBUTING.md) décrit les vérifications de la CI, les conventions de commit et le processus de publication. [docs/TESTING.md](docs/TESTING.md) indique ce que couvrent les tests, et ce qu’ils laissent volontairement de côté. Les échanges se font en anglais ou en chinois.

## Licence

[MIT](./LICENSE) © CatVinci Studio
