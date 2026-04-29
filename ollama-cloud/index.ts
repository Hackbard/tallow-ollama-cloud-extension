import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type {
	Api,
	OAuthCredentials,
	OAuthLoginCallbacks,
	OpenAICompletionsCompat,
} from "@mariozechner/pi-ai";

const PROVIDER_ID = "ollama-cloud";
const BASE_URL = "https://ollama.com/v1";
const FETCH_TIMEOUT_MS = 8_000;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OllamaModelInfo {
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	input: ("text" | "image")[];
}

/* ------------------------------------------------------------------ */
/*  Fallbacks                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_MODELS: OllamaModelInfo[] = [
	{ id: "deepseek-v3.1:671b", name: "DeepSeek V3.1", contextWindow: 128_000, maxTokens: 16_384, reasoning: false, input: ["text"] },
	{ id: "qwen3.5:397b", name: "Qwen 3.5", contextWindow: 128_000, maxTokens: 16_384, reasoning: false, input: ["text"] },
	{ id: "gemma4:31b", name: "Gemma 4", contextWindow: 128_000, maxTokens: 16_384, reasoning: false, input: ["text"] },
	{ id: "kimi-k2.5", name: "Kimi K2.5", contextWindow: 128_000, maxTokens: 16_384, reasoning: false, input: ["text"] },
	{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: 128_000, maxTokens: 16_384, reasoning: true, input: ["text"] },
	{ id: "gemini-3-flash-preview", name: "Gemini 3 Flash", contextWindow: 128_000, maxTokens: 16_384, reasoning: false, input: ["text", "image"] },
	{ id: "qwen3-vl:235b-instruct", name: "Qwen 3 VL", contextWindow: 128_000, maxTokens: 16_384, reasoning: false, input: ["text", "image"] },
	{ id: "cogito-2.1:671b", name: "Cogito 2.1", contextWindow: 128_000, maxTokens: 16_384, reasoning: true, input: ["text"] },
	{ id: "ministral-3:14b", name: "Ministral 3", contextWindow: 128_000, maxTokens: 16_384, reasoning: false, input: ["text"] },
	{ id: "glm-5.1", name: "GLM 5.1", contextWindow: 128_000, maxTokens: 16_384, reasoning: false, input: ["text"] },
];

/* ------------------------------------------------------------------ */
/*  Heuristics  (exported for testing)                                 */
/* ------------------------------------------------------------------ */

export const VISION_KEYWORDS = ["vl", "vision", "llava", "moondream", "qwen2.5-vl", "qwen3-vl", "gemini"];
export const REASONING_KEYWORDS = ["r1", "thinking", "cogito", "deepseek-v4", "qwq", "o1", "o3"];

export function guessInput(id: string): ("text" | "image")[] {
	const lower = id.toLowerCase();
	for (const kw of VISION_KEYWORDS) {
		if (lower.includes(kw)) return ["text", "image"];
	}
	return ["text"];
}

export function guessReasoning(id: string): boolean {
	const lower = id.toLowerCase();
	for (const kw of REASONING_KEYWORDS) {
		if (lower.includes(kw)) return true;
	}
	return false;
}

export function guessContextWindow(id: string): number {
	if (id.includes("kimi-k2")) return 256_000;
	return 128_000;
}

/* ------------------------------------------------------------------ */
/*  Network helpers                                                    */
/* ------------------------------------------------------------------ */

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const resp = await fetch(url, { ...init, signal: ctrl.signal });
		return resp;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Fetch the live model list from Ollama Cloud.
 * Uses the OpenAI-compatible `GET /v1/models` endpoint.
 * Does NOT require authentication.
 */
async function fetchOllamaModels(): Promise<OllamaModelInfo[] | null> {
	try {
		const resp = await fetchWithTimeout(`${BASE_URL}/models`);
		if (!resp.ok) {
			console.warn(`[ollama-cloud] Registry returned ${resp.status}`);
			return null;
		}

		const raw = (await resp.json()) as unknown;
		if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).data)) {
			console.warn("[ollama-cloud] Unexpected registry response shape");
			return null;
		}

		const data = raw as { data?: Array<{ id?: unknown }> };
		const infos: OllamaModelInfo[] = [];

		for (const entry of data.data ?? []) {
			if (typeof entry.id !== "string") continue;
			infos.push({
				id: entry.id,
				name: entry.id,
				contextWindow: guessContextWindow(entry.id),
				maxTokens: 16_384,
				reasoning: guessReasoning(entry.id),
				input: guessInput(entry.id),
			});
		}

		return infos;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`[ollama-cloud] Failed to fetch models: ${msg}`);
		return null;
	}
}

/* ------------------------------------------------------------------ */
/*  Provider builder                                                   */
/* ------------------------------------------------------------------ */

const OLLAMA_COMPAT: OpenAICompletionsCompat = {
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
};

export function buildModelConfigs(models: OllamaModelInfo[]) {
	return models.map((m) => ({
		id: m.id,
		name: m.name,
		api: "openai-completions" as Api,
		reasoning: m.reasoning,
		input: m.input,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
		compat: OLLAMA_COMPAT,
	}));
}

const OLLAMA_OAUTH = {
	name: "Ollama Cloud",
	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		const key = await callbacks.onPrompt({
			message: "Enter your Ollama Cloud API key (from https://ollama.com/settings/keys):",
		});
		if (!key || !key.trim()) {
			throw new Error("API key is required");
		}
		return {
			refresh: key.trim(),
			access: key.trim(),
			expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
		};
	},
	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return credentials;
	},
	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};

export function buildProviderConfig(models: OllamaModelInfo[], envApiKey?: string) {
	return {
		baseUrl: BASE_URL,
		api: "openai-completions" as Api,
		authHeader: true,
		apiKey: envApiKey,
		models: buildModelConfigs(models),
		oauth: OLLAMA_OAUTH,
	};
}

/* ------------------------------------------------------------------ */
/*  Extension entry                                                    */
/* ------------------------------------------------------------------ */

export default async function ollamaCloudExtension(pi: ExtensionAPI) {
	const envKey = process.env.OLLAMA_CLOUD_API_KEY;

	// 1. Fetch live models immediately (no auth required for /v1/models).
	let models = await fetchOllamaModels();
	if (!models || models.length === 0) {
		console.log("[ollama-cloud] Using fallback model list");
		models = DEFAULT_MODELS;
	} else {
		console.log(`[ollama-cloud] Loaded ${models.length} models from registry`);
	}

	pi.registerProvider(PROVIDER_ID, buildProviderConfig(models, envKey));

	// 2. Periodic refresh.
	let refreshInterval: ReturnType<typeof setInterval> | null = null;

	pi.on("session_start", () => {
		(async () => {
			try {
				const fetched = await fetchOllamaModels();
				if (fetched && fetched.length > 0) {
					pi.registerProvider(PROVIDER_ID, buildProviderConfig(fetched, envKey));
				}

				if (refreshInterval) {
					clearInterval(refreshInterval);
					refreshInterval = null;
				}
				refreshInterval = setInterval(() => {
					(async () => {
						try {
							const live = await fetchOllamaModels();
							if (live && live.length > 0) {
								pi.registerProvider(PROVIDER_ID, buildProviderConfig(live, envKey));
							}
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							console.error(`[ollama-cloud] Periodic refresh failed: ${msg}`);
						}
					})();
				}, 5 * 60 * 1000);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[ollama-cloud] session_start handler error: ${msg}`);
			}
		})();
	});

	pi.on("session_shutdown", () => {
		if (refreshInterval) {
			clearInterval(refreshInterval);
			refreshInterval = null;
		}
	});

	// 3. Manual refresh command.
	pi.registerCommand("ollama-refresh", {
		description: "Refresh Ollama Cloud model list from the API",
		async handler(_args: string, ctx: ExtensionCommandContext) {
			ctx.ui.notify("Fetching Ollama Cloud models…", "info");
			try {
				const fetched = await fetchOllamaModels();

				if (!fetched || fetched.length === 0) {
					ctx.ui.notify("Failed to fetch models. Keeping current list.", "warning");
					return;
				}

				pi.registerProvider(PROVIDER_ID, buildProviderConfig(fetched, envKey));
				ctx.ui.notify(`Refreshed ${fetched.length} Ollama Cloud models.`, "info");
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[ollama-cloud] /ollama-refresh failed: ${msg}`);
				ctx.ui.notify(`Refresh failed: ${msg}`, "error");
			}
		},
	});
}
