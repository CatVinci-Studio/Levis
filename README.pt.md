<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Textus" width="120" height="120" />
</p>

<h1 align="center">Textus</h1>

<p align="center">
  <strong>O editor de Markdown de nova geração.</strong><br>
  A caneta é sua. A IA cuida da tinta.
</p>

<p align="center">
  <a href="https://textus.catvinci.com"><strong>Site</strong></a> ·
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><strong>Baixar</strong></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.zh-Hant.md">繁體中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.ru.md">Русский</a> ·
  Português
</p>

<p align="center">
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><img alt="version" src="https://img.shields.io/github/v/release/CatVinci-Studio/Textus"></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-yellow"></a>
</p>

<p align="center">
  <img src="docs/images/readme/pt/hero.png" alt="O Textus com Hamlet aberto. Ao lado, a Textus AI propõe uma edição frase a frase, com o motivo, e fixa um comentário de revisão numa linha." width="860" />
</p>

## Escrita

### O que você vê é o que você obtém

Toda a sintaxe do Markdown, formatada enquanto você escreve. Passe o cursor sobre uma linha para ver o Markdown dela.

### Fórmulas, tabelas, diagramas

As fórmulas aparecem enquanto você digita, as tabelas se alinham sozinhas e poucas linhas de texto viram um diagrama.

### Seu estilo de escrita? Você decide

Quatro modos de escrita e o tema que você quiser, inclusive os do Typora.

- **Modo Zen**: tudo sai de cena, menos as suas palavras.
- **Modo Máquina de Escrever**: a linha que você está escrevendo fica sempre na mesma altura.
- **Visualização Dividida**: o Markdown de um lado, a página pronta do outro.
- **Modo Código-Fonte**: o documento inteiro em Markdown puro.

<p align="center">
  <img src="docs/images/readme/pt/split.png" alt="Visualização Dividida" width="49%" />
  <img src="docs/images/readme/pt/zen.png" alt="Modo Zen" width="49%" />
</p>

### Compartilhe onde quiser

Exporte para PDF, Word, HTML e mais.

## Textus AI

**A IA sugere. A decisão é sua.** A Textus AI ajuda do rascunho à revisão. Cada palavra continua sua.

- **Continuação**: Pare um instante e as próximas palavras surgem em cinza. Tab para aceitar.
- **Escrita com IA**: As edições chegam como propostas, cada uma com o seu motivo. Aceite tudo de uma vez ou frase a frase.
- **Verificação gramatical**: Ortografia e gramática conferidas enquanto você escreve, de acordo com as suas normas de escrita. Alt+Enter corrige.
- **Comentários**: Comentários fixados nas linhas a que se referem. Observações, não reescritas.
- **Habilidades integradas**: Enxugar, revisar, traduzir, mudar o tom e mais: é só digitar uma barra.
- **Ela conhece a sua obra**: Aprende o seu estilo, lembra seus personagens e lugares e segue suas instruções.

**Use a IA que preferir**: Entre com o ChatGPT ou o Claude, adicione uma chave de API ou rode um modelo no seu próprio computador.

OpenAI · Anthropic · Google Gemini · DeepSeek · xAI · Mistral · Groq · OpenRouter · Kimi · GLM · Qwen · Ollama · Qualquer endpoint compatível com OpenAI

## Privacidade

O que você escreve é seu. O Textus foi feito para que continue assim, e o código é aberto: qualquer pessoa pode conferir.

- **No seu dispositivo**: Os documentos são arquivos Markdown comuns, guardados onde você quiser.
- **Chaves guardadas aqui**: Chaves de API e logins ficam salvos só no seu computador.
- **Direto para o provedor**: As requisições de IA saem do seu dispositivo direto para o provedor que você escolher.
- **Sem conta**: Baixe e comece a escrever. Não há cadastro.
- **Sem rastreamento**: Sem analytics, sem telemetria, sem anúncios.
- **Código aberto**: Licença MIT e código público, linha por linha, para que qualquer pessoa confira tudo isso.

Com um modelo local no Ollama, suas palavras nunca saem do seu computador.

## Instalação

macOS (Apple Silicon) pelo [Homebrew](https://brew.sh):

```sh
brew install --cask catvinci-studio/tap/textus
```

Arch Linux pelo repositório pacman assinado [`[catvinci]`](https://github.com/CatVinci-Studio/arch-repo) (uma vez só; depois `sudo pacman -Syu` mantém o Textus atualizado):

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/CatVinci-Studio/arch-repo/main/install.sh) textus-bin
```

Ou baixe um instalador em [Releases](https://github.com/CatVinci-Studio/Textus/releases/latest):

| Plataforma            | Instalador                                                                 |
| --------------------- | -------------------------------------------------------------------------- |
| macOS (Apple Silicon) | `Textus_X.Y.Z_aarch64.dmg`                                                 |
| Windows               | `Textus_X.Y.Z_x64-setup.exe`                                               |
| Linux                 | `Textus_X.Y.Z_amd64.AppImage` · `_amd64.deb` · `Textus-X.Y.Z-1.x86_64.rpm` |

## Primeiros passos

1. Abra o Textus. Ele começa com um rascunho em branco; você só precisa de um arquivo ao salvar.
2. Abra **Ajustes → Textus AI**, escolha um provedor e faça login ou cole uma chave em **Login e credenciais**.
3. Comece a escrever. Quando você para, a continuação aparece em cinza; Tab aceita.
4. Abra o Painel de IA pelo botão de chat na barra da janela. **Ajuda → Guia dos Recursos de IA** explica o resto.

| Ação                        | Atalho                         |
| --------------------------- | ------------------------------ |
| Painel de IA                | Ctrl/⌘+Shift+L                 |
| Pergunta rápida             | Ctrl/⌘+Shift+K                 |
| Sugerir continuação agora   | Ctrl/⌘+Shift+Space             |
| Verificar gramática agora   | Ctrl/⌘+Shift+G                 |
| Aceitar uma edição pendente | Ctrl/⌘+Enter                   |
| Visualização Dividida       | Ctrl/⌘+Shift+E                 |
| Modo Zen                    | Ctrl/⌘+Shift+J (Esc para sair) |
| Modo Código-Fonte           | Ctrl/⌘+/                       |

Todos podem ser alterados em **Ajustes → Atalhos**.

## Compilar a partir do código

```bash
git clone https://github.com/CatVinci-Studio/Textus.git
cd Textus
npm install

npm run tauri dev     # full Tauri app (Rust shell + Vite renderer)
npm run tauri build   # bundle .dmg / -setup.exe (NSIS) / .AppImage / .deb / .rpm
npm run build         # frontend only: type-check (tsc) + vite build
```

É preciso ter [Node.js](https://nodejs.org) 22+, [Rust](https://rustup.rs) (stable) e as ferramentas de compilação de cada plataforma (Xcode CLT no macOS; `libwebkit2gtk-4.1-dev`/`libappindicator3-dev`/`librsvg2-dev`/`patchelf` no Linux; MSVC Build Tools no Windows).

## Como contribuir

O [CONTRIBUTING.md](CONTRIBUTING.md) descreve as verificações da CI, as convenções de commit e o processo de lançamento. O [docs/TESTING.md](docs/TESTING.md) mostra o que os testes cobrem e o que deixam de fora de propósito. As conversas são em inglês ou chinês.

## Licença

[MIT](./LICENSE) © CatVinci Studio
