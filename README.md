<div align="center">

# 🦙 pi-ollama-cloud

**Connect [Pi](https://pi.dev) / [Tallow](https://tallow.dungle-scrubs.com) to Ollama Cloud with live model discovery**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Pi Package](https://img.shields.io/badge/pi-package-blue?logo=terminal)](https://pi.dev)

</div>

---

*An extension for [pi](https://pi.dev) / [tallow](https://tallow.dungle-scrubs.com) that registers Ollama Cloud as a first-class provider. Automatically discovers all available cloud models via the OpenAI-compatible `/v1/models` endpoint — no manual `models.json` editing required.*

**Why use this?** Instead of manually maintaining a static list of Ollama Cloud models in `~/.pi/agent/models.json`, this extension fetches the live registry on startup, keeps it fresh every 5 minutes, and adds a `/login ollama-cloud` flow so you can authenticate directly from within your agent session.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [What You Get](#what-you-get)
- [Commands](#commands)
- [Configuration](#configuration)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Quick Start

```bash
# 1. Install the extension
pi install git:github.com/your-username/pi-ollama-cloud

# 2. Start tallow / pi
tallow

# 3. Pick an Ollama Cloud model
/model
# → Select any ollama-cloud/... model

# 4. Log in with your API key
/login ollama-cloud
# → Paste your key from https://ollama.com/settings/keys
```

That's it. The model list stays in sync with Ollama Cloud automatically.

---

## Installation

### Option A: Via `pi install` (Recommended)

```bash
pi install git:github.com/your-username/pi-ollama-cloud
```

Then `/reload` or restart your pi/tallow session.

### Option B: Manual Drop-in

```bash
# For pi
git clone https://github.com/your-username/pi-ollama-cloud.git
cp -r pi-ollama-cloud/ollama-cloud ~/.pi/agent/extensions/

# For tallow
git clone https://github.com/your-username/pi-ollama-cloud.git
cp -r pi-ollama-cloud/ollama-cloud ~/.tallow/extensions/
```

Then `/reload` or restart.

### Option C: As a Pi Package

Add a dependency to your project's `package.json` if you bundle extensions:

```json
{
  "pi": {
    "extensions": ["./node_modules/pi-ollama-cloud/ollama-cloud"]
  }
}
```

---

## What You Get

| Capability | Description |
|------------|-------------|
| **Live model discovery** | Fetches all available Ollama Cloud models from `https://ollama.com/v1/models` on startup |
| **Auto-refresh** | Refreshes the model list every 5 minutes while your session is active |
| **`/login ollama-cloud`** | Interactive OAuth login prompt. Stores your API key securely in `~/.pi/agent/auth.json` |
| **`/ollama-refresh`** | Manual refresh command when you want the latest models right now |
| **Smart defaults** | Falls back to 10 known models if the registry is unreachable (no breakage) |
| **Heuristic tagging** | Automatically detects vision-capable (`vl`, `vision`, `gemini`) and reasoning (`r1`, `thinking`, `deepseek-v4`) models |
| **OpenAI-compatible API** | Uses `openai-completions` transport with correct Ollama compat flags |

### Smart model heuristics

The extension guesses capabilities for every discovered model:

| Model ID pattern | Detected capability |
|------------------|---------------------|
| `*-vl-*`, `*vision*`, `*llava*`, `gemini*` | `input: ["text", "image"]` |
| `*r1*`, `*thinking*`, `*cogito*`, `deepseek-v4*` | `reasoning: true` |
| `kimi-k2*` | `contextWindow: 256_000` |
| everything else | `contextWindow: 128_000`, `input: ["text"]` |

These are best-effort heuristics. If a model is mis-tagged, use `/model` details or open an issue.

---

## Commands

| Command | Description |
|---------|-------------|
| `/login ollama-cloud` | Prompt for your Ollama Cloud API key and store it |
| `/ollama-refresh` | Manually re-fetch the latest model list from Ollama Cloud |

---

## Configuration

### Environment variable

You can skip `/login` entirely by setting your key as an environment variable:

```bash
export OLLAMA_CLOUD_API_KEY="sk-..."
tallow
```

When this variable is present, the extension uses it directly and still refreshes the model list automatically.

### Per-project override

If you need to pin a specific Ollama Cloud model in a project, add this to `.pi/settings.json` or `.tallow/settings.json`:

```json
{
  "defaultProvider": "ollama-cloud",
  "defaultModel": "qwen3.5:397b"
}
```

---

## FAQ

**Q: Is the model list fetched with or without authentication?**  
A: The model registry at `https://ollama.com/v1/models` is public — no API key is needed to discover models. You only need a key for the actual chat completions (`POST /v1/chat/completions`).

**Q: Where is my API key stored?**  
A: It is stored in `~/.pi/agent/auth.json` (or `~/.tallow/auth.json`) by pi/tallow's built-in OAuth credential manager. The extension never writes keys to its own files.

**Q: Do I need to run `/ollama-refresh` manually?**  
A: No. The extension refreshes automatically every 5 minutes and on every `session_start`. The command exists only if you want an immediate refresh (e.g., after a new model announcement).

**Q: What happens if Ollama Cloud is down?**  
A: The extension falls back to a built-in list of 10 known models. Your session keeps working.

**Q: Can I use this with local Ollama instead?**  
A: No — this extension is specifically for Ollama Cloud (`ollama.com`). For local Ollama (`localhost:11434`), add a static provider block to `~/.pi/agent/models.json` instead:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [{ "id": "llama3.3" }]
    }
  }
}
```

**Q: A new model is not showing the right capabilities. How do I fix it?**  
A: Open an issue with the model ID. The heuristics are regex-based and may need an update for new naming conventions.

**Q: Does this work with plain `pi` or only `tallow`?**  
A: Both. The extension targets the `@mariozechner/pi-coding-agent` extension API, which is shared between pi and tallow.

---

## Troubleshooting

### "No API key configured" when trying to chat

You have selected an Ollama Cloud model but have not authenticated:

```
/login ollama-cloud
```

Or set the environment variable before starting:

```bash
export OLLAMA_CLOUD_API_KEY="sk-..."
```

### Model list is empty or stale

Run a manual refresh:

```
/ollama-refresh
```

If that fails, check your network connection to `https://ollama.com/v1/models`. The extension uses a 8-second timeout — slow networks may need a retry.

### Extension does not appear after install

Ensure you ran `/reload` or restarted pi/tallow. Extensions are discovered at startup.

---

## Contributing

PRs welcome! Before opening a PR:

1. Test the extension locally by dropping it into `~/.pi/agent/extensions/ollama-cloud/` or `~/.tallow/extensions/ollama-cloud/`.
2. Run `/reload` and verify `/model` lists Ollama Cloud models.
3. Check that `/login ollama-cloud` stores credentials and that chat completions work.

If you find a model with incorrect capability detection, include the exact model ID in your issue.

---

## License

[MIT](LICENSE)
