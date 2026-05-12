import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const PROVIDER_ID = "ollama-cloud";
const BASE_URL = "https://ollama.com/v1";
const TAGS_URL = "https://ollama.com/api/tags";

const VISION_KEYWORDS = ["vl", "vision", "llava", "moondream", "qwen2.5-vl", "qwen3-vl", "gemini"];
const REASONING_KEYWORDS = ["r1", "thinking", "cogito", "deepseek-v4", "qwq", "o1", "o3"];

const DEFAULT_MODELS = [
	{ id: "deepseek-v3.1:671b", name: "DeepSeek V3.1", reasoning: false, vision: false },
	{ id: "qwen3.5:397b", name: "Qwen 3.5", reasoning: false, vision: false },
	{ id: "gemma4:31b", name: "Gemma 4", reasoning: false, vision: false },
	{ id: "kimi-k2.5", name: "Kimi K2.5", reasoning: false, vision: false },
	{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true, vision: false },
	{ id: "gemini-3-flash-preview", name: "Gemini 3 Flash", reasoning: false, vision: true },
	{ id: "qwen3-vl:235b-instruct", name: "Qwen 3 VL", reasoning: false, vision: true },
	{ id: "cogito-2.1:671b", name: "Cogito 2.1", reasoning: true, vision: false },
	{ id: "ministral-3:14b", name: "Ministral 3", reasoning: false, vision: false },
	{ id: "glm-5.1", name: "GLM 5.1", reasoning: false, vision: false },
];

function guessVision(id: string): boolean {
	const lower = id.toLowerCase();
	for (const kw of VISION_KEYWORDS) if (lower.includes(kw)) return true;
	return false;
}

function guessReasoning(id: string): boolean {
	const lower = id.toLowerCase();
	for (const kw of REASONING_KEYWORDS) if (lower.includes(kw)) return true;
	return false;
}

function guessContextWindow(id: string): number {
	if (id.includes("kimi-k2")) return 256_000;
	return 128_000;
}

function buildModelConfig(entry: { name: string }) {
	const id = entry.name;
	return {
		id, name: id,
		api: "openai-completions",
		reasoning: guessReasoning(id),
		input: guessVision(id) ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: guessContextWindow(id),
		maxTokens: 16_384,
		compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
	};
}

function buildDefaultModelConfig(m: typeof DEFAULT_MODELS[number]) {
	return {
		id: m.id, name: m.name,
		api: "openai-completions",
		reasoning: m.reasoning,
		input: m.vision ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: guessContextWindow(m.id),
		maxTokens: 16_384,
		compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
	};
}

/* ------------------------------------------------------------------ */
/*  Extension entry                                                    */
/* ------------------------------------------------------------------ */

export default function (pi: ExtensionAPI) {
	const envKey = process.env.OLLAMA_CLOUD_API_KEY || undefined;
	let registeredModelIds: string[] = [];

	async function refreshFromApi(apiKey?: string): Promise<ReturnType<typeof buildModelConfig>[] | null> {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 8_000);
		try {
			const headers: Record<string, string> = {};
			const key = apiKey || envKey;
			if (key) headers["Authorization"] = `Bearer ${key}`;
			const resp = await fetch(TAGS_URL, { headers, signal: ctrl.signal });
			if (!resp.ok) return null;
			const data = (await resp.json()) as any;
			if (!data?.models || !Array.isArray(data.models)) return null;
			return (data.models as Array<{ name: string }>).filter((e) => typeof e.name === "string").map(buildModelConfig);
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
		}
	}

	function registerModels(modelConfigs: ReturnType<typeof buildModelConfig>[]) {
		const ids = modelConfigs.map((m) => m.id).sort();
		if (registeredModelIds.join(",") === ids.join(",")) return;
		registeredModelIds = ids;

		pi.registerProvider(PROVIDER_ID, {
			baseUrl: BASE_URL,
			api: "openai-completions",
			authHeader: true,
			apiKey: envKey,
			models: modelConfigs,
			oauth: {
				name: "Ollama Cloud",
				async login(callbacks: { onPrompt(opts: { message: string }): Promise<string> }) {
					const key = await callbacks.onPrompt({
						message: "Enter your Ollama Cloud API key (from https://ollama.com/settings/keys):",
					});
					if (!key || !key.trim()) throw new Error("API key is required");
					const trimmed = key.trim();

					// Refresh model list with the new key right after login
					refreshFromApi(trimmed).then((models) => {
						if (models && models.length > 0) registerModels(models);
					});

					return {
						access: trimmed,
						refresh: trimmed,
						expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
					};
				},
				async refreshToken(creds: { access: string; refresh: string; expires: number }) {
					return creds;
				},
				getApiKey(creds: { access: string }) {
					return creds.access;
				},
			},
		});

		console.log(`[ollama-cloud] Registered ${modelConfigs.length} models`);
	}

	// Register defaults on startup — no network call
	registerModels(DEFAULT_MODELS.map(buildDefaultModelConfig));

	// Manual refresh command
	pi.registerCommand("ollama-refresh", {
		description: "Refresh Ollama Cloud model list from the API",
		async handler(_args: string, ctx: ExtensionCommandContext) {
			ctx.ui.notify("Fetching Ollama Cloud models...", "info");
			const models = await refreshFromApi();
			if (!models || models.length === 0) {
				ctx.ui.notify("Failed to fetch models. Keeping current list.", "warning");
				return;
			}
			registerModels(models);
			ctx.ui.notify(`Refreshed ${models.length} Ollama Cloud models.`, "info");
		},
	});
}
