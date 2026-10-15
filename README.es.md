<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Textus" width="120" height="120" />
</p>

<h1 align="center">Textus</h1>

<p align="center">
  <strong>El editor de Markdown de nueva generación.</strong><br>
  Tú pones la pluma. La IA, la tinta.
</p>

<p align="center">
  <a href="https://textus.catvinci.com"><strong>Sitio web</strong></a> ·
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><strong>Descargar</strong></a>
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.zh-Hant.md">繁體中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.ko.md">한국어</a> ·
  Español ·
  <a href="./README.fr.md">Français</a> ·
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
  <img src="docs/images/readme/es/hero.png" alt="Textus con Hamlet abierto. Al lado, Textus AI propone un cambio razonado, frase a frase, y deja un comentario junto a una línea." width="860" />
</p>

## Escritura

### Lo que ves es lo que obtienes

Todo el Markdown, con formato mientras escribes. Pasa el puntero por una línea para ver su código.

### Fórmulas, tablas y diagramas

Las fórmulas se muestran mientras escribes, las tablas se alinean solas y unas pocas líneas de texto bastan para un diagrama.

### ¿Tu estilo de escritura? Tú decides

Cuatro modos de escritura y el tema que prefieras, incluidos los de Typora.

- **Modo zen**: todo se aparta salvo tus palabras.
- **Modo máquina de escribir**: la línea que escribes se queda siempre a la misma altura.
- **Vista dividida**: Markdown a un lado, la página terminada al otro.
- **Modo código fuente**: todo el documento en Markdown sin formato.

<p align="center">
  <img src="docs/images/readme/es/split.png" alt="Vista dividida" width="49%" />
  <img src="docs/images/readme/es/zen.png" alt="Modo zen" width="49%" />
</p>

### Compártelo donde quieras

Exporta a PDF, Word, HTML y más.

## Textus AI

**La IA propone. Tú decides.** Textus AI te acompaña en cada paso. Las palabras siguen siendo tuyas.

- **Autocompletado**: Haz una pausa y las palabras siguientes aparecen en gris. Pulsa Tab para aceptarlas.
- **Escritura con IA**: Los cambios llegan como propuestas, cada una con su motivo. Acéptalas enteras o frase a frase.
- **Revisión gramatical**: Detecta erratas y errores gramaticales mientras escribes, y comprueba tus normas de escritura. Alt+Enter los corrige.
- **Comentarios**: Notas junto a la línea a la que se refieren. Comenta, no reescribe.
- **Habilidades integradas**: Condensar, corregir, traducir, cambiar el tono y más, con solo teclear /.
- **Te conoce**: Aprende tu estilo, recuerda a tus personajes y lugares, y sigue tus instrucciones.

**Usa la IA que prefieras**: Inicia sesión con ChatGPT o Claude, añade una clave de API o ejecuta un modelo en tu propio ordenador.

OpenAI · Anthropic · Google Gemini · DeepSeek · xAI · Mistral · Groq · OpenRouter · Kimi · GLM · Qwen · Ollama · Cualquier servicio compatible con OpenAI

## Privacidad

Lo que escribes es tuyo. Textus está hecho para que siga siéndolo, y su código es abierto para que cualquiera lo compruebe.

- **En tu dispositivo**: Los documentos son archivos Markdown normales, guardados donde tú elijas.
- **Claves en tu equipo**: Las claves de API y los inicios de sesión se guardan solo en tu ordenador.
- **Directo a tu proveedor**: Las peticiones de IA van directamente de tu dispositivo al proveedor que elijas.
- **Sin cuenta**: Descárgalo y escribe. No hay nada en lo que registrarse.
- **Sin rastreo**: Sin analíticas, sin telemetría, sin anuncios.
- **Código abierto**: Con licencia MIT y abierto línea a línea: cualquiera puede comprobar todo esto.

Con un modelo local a través de Ollama, tus palabras nunca salen de tu ordenador.

## Instalación

macOS (Apple Silicon) con [Homebrew](https://brew.sh):

```sh
brew install --cask catvinci-studio/tap/textus
```

Arch Linux con el repositorio de pacman firmado [`[catvinci]`](https://github.com/CatVinci-Studio/arch-repo) (una sola vez; después `sudo pacman -Syu` mantiene Textus al día):

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/CatVinci-Studio/arch-repo/main/install.sh) textus-bin
```

O descarga un instalador desde [Releases](https://github.com/CatVinci-Studio/Textus/releases/latest):

| Plataforma            | Instalador                                                                 |
| --------------------- | -------------------------------------------------------------------------- |
| macOS (Apple Silicon) | `Textus_X.Y.Z_aarch64.dmg`                                                 |
| Windows               | `Textus_X.Y.Z_x64-setup.exe`                                               |
| Linux                 | `Textus_X.Y.Z_amd64.AppImage` · `_amd64.deb` · `Textus-X.Y.Z-1.x86_64.rpm` |

## Primeros pasos

1. Abre Textus. Empieza con un borrador en blanco; solo necesitas un archivo al guardar.
2. Abre **Ajustes → Textus AI**, elige un proveedor e inicia sesión o pega una clave en **Acceso y credenciales**.
3. Empieza a escribir. Cuando haces una pausa, la continuación aparece en gris; Tab la acepta.
4. Abre el Panel de IA con el botón de chat de la barra de la ventana. **Ayuda → Guía de funciones de IA** explica el resto.

| Acción                        | Atajo                           |
| ----------------------------- | ------------------------------- |
| Panel de IA                   | Ctrl/⌘+Shift+L                  |
| Pregunta rápida               | Ctrl/⌘+Shift+K                  |
| Sugerir continuación ahora    | Ctrl/⌘+Shift+Space              |
| Revisar gramática ahora       | Ctrl/⌘+Shift+G                  |
| Aceptar una edición pendiente | Ctrl/⌘+Enter                    |
| Vista dividida                | Ctrl/⌘+Shift+E                  |
| Modo zen                      | Ctrl/⌘+Shift+J (Esc para salir) |
| Modo código fuente            | Ctrl/⌘+/                        |

Todos se pueden cambiar en **Ajustes → Atajos de teclado**.

## Compilar desde el código

```bash
git clone https://github.com/CatVinci-Studio/Textus.git
cd Textus
npm install

npm run tauri dev     # full Tauri app (Rust shell + Vite renderer)
npm run tauri build   # bundle .dmg / -setup.exe (NSIS) / .AppImage / .deb / .rpm
npm run build         # frontend only: type-check (tsc) + vite build
```

Necesitas [Node.js](https://nodejs.org) 22 o posterior, [Rust](https://rustup.rs) (stable) y las herramientas de compilación de cada plataforma (Xcode CLT en macOS; `libwebkit2gtk-4.1-dev`/`libappindicator3-dev`/`librsvg2-dev`/`patchelf` en Linux; MSVC Build Tools en Windows).

## Contribuir

En [CONTRIBUTING.md](CONTRIBUTING.md) están las comprobaciones que ejecuta la CI, las convenciones de commits y el proceso de publicación. [docs/TESTING.md](docs/TESTING.md) explica qué cubren las pruebas y qué dejan fuera a propósito. Las conversaciones son en inglés o chino.

## Licencia

[MIT](./LICENSE) © CatVinci Studio
