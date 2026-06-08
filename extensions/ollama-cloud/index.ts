import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDER_ID = "ollama-cloud";
const BASE_URL = "https://ollama.com/v1";
const MODELS_URL = "https://ollama.com/v1/models";
const SHOW_URL = "https://ollama.com/api/show";
const CACHE_PATH = join(dirname(fileURLToPath(import.meta.url)), "models-cache.json");
const CACHE_VERSION = 2;

const VISION_KEYWORDS = ["vl", "vision", "llava", "moondream", "qwen2.5-vl", "qwen3-vl", "gemini"];
const REASONING_KEYWORDS = ["r1", "thinking", "cogito", "deepseek-v4", "qwq", "o1", "o3"];

const DEFAULT_MODELS = [
	{ id: "deepseek-v3.1:671b", name: "DeepSeek V3.1", reasoning: false, vision: false },
	{ id: "qwen3.5:397b", name: "Qwen 3.5", reasoning: false, vision: false },
	{ id: "gemma4:31b", name: "Gemma 4", reasoning: false, vision: false },
	{ id: "kimi-k2.5", name: "Kimi K2.5", reasoning: false, vision: false },
	{ id: "kimi-k2.6", name: "Kimi K2.6", reasoning: false, vision: false },
	{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", reasoning: true, vision: false },
	{ id: "gemini-3-flash-preview", name: "Gemini 3 Flash", reasoning: false, vision: true },
	{ id: "qwen3-vl:235b-instruct", name: "Qwen 3 VL", reasoning: false, vision: true },
	{ id: "cogito-2.1:671b", name: "Cogito 2.1", reasoning: true, vision: false },
	{ id: "ministral-3:14b", name: "Ministral 3", reasoning: false, vision: false },
	{ id: "glm-5.1", name: "GLM 5.1", reasoning: false, vision: false },
];

interface ModelDetail {
	capabilities: string[];
	details: {
		parameter_size: string;
		quantization_level: string;
		family: string;
		families: string[];
		format: string;
	};
	model_info: {
		context_length?: number;
		embedding_length?: number;
		[key: string]: any;
	};
	modelfile?: string;
	template?: string;
	parameters?: string;
	license?: string[];
	system?: string;
}

function extractContextLength(modelInfo: ModelDetail["model_info"]): number | undefined {
	if (!modelInfo) return undefined;
	if (typeof modelInfo.context_length === "number") return modelInfo.context_length;
	const contextKey = Object.keys(modelInfo).find((k) => k.endsWith(".context_length"));
	if (contextKey && typeof modelInfo[contextKey] === "number") return modelInfo[contextKey];
	return undefined;
}

interface EnhancedModelConfig {
	id: string;
	name: string;
	api: "openai-completions";
	reasoning: boolean;
	input: string[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	compat: {
		supportsDeveloperRole: boolean;
		supportsReasoningEffort: boolean;
		supportsTools: boolean;
		supportsVision: boolean;
	};
	_capabilities?: string[];
	_detailFetchedAt?: string;
}

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

function buildModelConfigFromGuess(id: string): EnhancedModelConfig {
	return {
		id,
		name: id,
		api: "openai-completions",
		reasoning: guessReasoning(id),
		input: guessVision(id) ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: guessContextWindow(id),
		maxTokens: 16_384,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: guessReasoning(id),
			supportsTools: false,
			supportsVision: guessVision(id),
		},
		_capabilities: [],
		_detailFetchedAt: new Date().toISOString(),
	};
}

function buildDefaultModelConfig(m: typeof DEFAULT_MODELS[number]): EnhancedModelConfig {
	return {
		id: m.id,
		name: m.name,
		api: "openai-completions",
		reasoning: m.reasoning,
		input: m.vision ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: guessContextWindow(m.id),
		maxTokens: 16_384,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: m.reasoning,
			supportsTools: false,
			supportsVision: m.vision,
		},
		_capabilities: [],
		_detailFetchedAt: new Date().toISOString(),
	};
}

function buildModelConfigFromDetail(modelId: string, detail: ModelDetail): EnhancedModelConfig {
	const capabilities = detail.capabilities || [];
	const hasVision = capabilities.includes("vision");
	const hasReasoning = capabilities.includes("thinking");
	const hasTools = capabilities.includes("tools");
	
	const contextLength = extractContextLength(detail.model_info) || guessContextWindow(modelId);
	const maxTokens = Math.min(contextLength, 16_384);

	return {
		id: modelId,
		name: modelId,
		api: "openai-completions",
		reasoning: hasReasoning,
		input: hasVision ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: contextLength,
		maxTokens,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: hasReasoning,
			supportsTools: hasTools,
			supportsVision: hasVision,
		},
		_capabilities: capabilities,
		_detailFetchedAt: new Date().toISOString(),
	};
}

interface CacheFile {
	version: number;
	models: EnhancedModelConfig[];
	fetchedAt: string;
}

function loadCache(): EnhancedModelConfig[] | null {
	if (!existsSync(CACHE_PATH)) return null;
	try {
		const raw = readFileSync(CACHE_PATH, "utf-8");
		const data = JSON.parse(raw);
		
		// Handle old cache format (v1) - array of models without version
		if (Array.isArray(data)) {
			console.log("[ollama-cloud] Migrating cache from v1 to v2");
			return migrateCacheV1(data);
		}
		
		// Handle new cache format (v2)
		if (data && typeof data === "object" && data.version === CACHE_VERSION && Array.isArray(data.models)) {
			return data.models;
		}
		
		return null;
	} catch {
		return null;
	}
}

function migrateCacheV1(oldModels: any[]): EnhancedModelConfig[] {
	return oldModels.map((m) => ({
		...m,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: m.reasoning || false,
			supportsTools: false,
			supportsVision: m.input?.includes("image") || false,
		},
		_capabilities: m._capabilities || [],
		_detailFetchedAt: m._detailFetchedAt || new Date().toISOString(),
	} as EnhancedModelConfig));
}

function saveCache(models: EnhancedModelConfig[]) {
	try {
		const cacheFile: CacheFile = {
			version: CACHE_VERSION,
			models,
			fetchedAt: new Date().toISOString(),
		};
		writeFileSync(CACHE_PATH, JSON.stringify(cacheFile, null, 2) + "\n", "utf-8");
	} catch {
		// ignore write errors
	}
}

async function fetchModelList(apiKey?: string): Promise<string[] | null> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 10_000);
	try {
		const headers: Record<string, string> = {};
		const key = apiKey;
		if (key) headers["Authorization"] = `Bearer ${key}`;
		const resp = await fetch(MODELS_URL, { headers, signal: ctrl.signal });
		if (!resp.ok) return null;
		const data = (await resp.json()) as any;
		// Ollama Cloud returns OpenAI-compatible format: { object: "list", data: [{ id: "model-id", ... }] }
		const models = data?.data;
		if (!Array.isArray(models)) return null;
		return models
			.filter((m: any) => typeof m?.id === "string")
			.map((m: any) => m.id);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

async function fetchModelDetails(modelId: string, apiKey?: string): Promise<ModelDetail | null> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 10_000);
	try {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		const key = apiKey;
		if (key) headers["Authorization"] = `Bearer ${key}`;
		const resp = await fetch(SHOW_URL, {
			method: "POST",
			headers,
			body: JSON.stringify({ model: modelId }),
			signal: ctrl.signal,
		});
		if (!resp.ok) return null;
		const data = (await resp.json()) as any;
		if (!data || typeof data !== "object") return null;
		return data as ModelDetail;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

async function refreshFromApi(apiKey?: string): Promise<EnhancedModelConfig[] | null> {
	const modelIds = await fetchModelList(apiKey);
	if (!modelIds || modelIds.length === 0) return null;

	const models: EnhancedModelConfig[] = [];
	
	// Fetch details for each model (with concurrency limit to avoid rate limiting)
	const CONCURRENCY = 3;
	for (let i = 0; i < modelIds.length; i += CONCURRENCY) {
		const batch = modelIds.slice(i, i + CONCURRENCY);
		const results = await Promise.all(
			batch.map(async (modelId) => {
				const detail = await fetchModelDetails(modelId, apiKey);
				if (detail) {
					return buildModelConfigFromDetail(modelId, detail);
				}
				// Fallback to guessing if detail fetch fails
				console.log(`[ollama-cloud] Failed to fetch details for ${modelId}, using guess`);
				return buildModelConfigFromGuess(modelId);
			})
		);
		models.push(...results);
	}

	return models;
}

export default function (pi: ExtensionAPI) {
	const envKey = process.env.OLLAMA_CLOUD_API_KEY || undefined;
	let registeredModelIds: string[] = [];

	function registerModels(modelConfigs: EnhancedModelConfig[]) {
		const ids = modelConfigs.map((m) => m.id).sort();
		if (registeredModelIds.join(",") === ids.join(",")) return;
		registeredModelIds = ids;

		const providerConfig: any = {
			baseUrl: BASE_URL,
			api: "openai-completions",
			authHeader: true,
			models: modelConfigs,
			oauth: {
				name: "Ollama Cloud",
				async login(callbacks: { onPrompt(opts: { message: string }): Promise<string> }) {
					const key = await callbacks.onPrompt({
						message: "Enter your Ollama Cloud API key (from https://ollama.com/settings/keys):",
					});
					if (!key || !key.trim()) throw new Error("API key is required");
					const trimmed = key.trim();

					refreshFromApi(trimmed).then((models) => {
						if (models && models.length > 0) {
							registerModels(models);
							saveCache(models);
						}
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
		};
		if (envKey) {
			providerConfig.apiKey = envKey;
		}
		pi.registerProvider(PROVIDER_ID, providerConfig);
	}

	// BOOT: load cached models (fast, synchronous) so findInitialModel sees them immediately.
	const cached = loadCache();
	if (cached) {
		registerModels(cached);
	} else {
		registerModels(DEFAULT_MODELS.map(buildDefaultModelConfig));
	}

	// BACKGROUND: silently refresh from API and update cache for next boot.
	refreshFromApi().then((models) => {
		if (models && models.length > 0) {
			registerModels(models);
			saveCache(models);
		}
	});

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
			saveCache(models);
			ctx.ui.notify(`Refreshed ${models.length} Ollama Cloud models.`, "info");
		},
	});
}