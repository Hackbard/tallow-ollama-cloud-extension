import { describe, expect, test, beforeEach } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	CACHE_FILE,
	VISION_KEYWORDS,
	REASONING_KEYWORDS,
	guessInput,
	guessReasoning,
	guessContextWindow,
	buildModelConfigs,
	buildProviderConfig,
	loadModelCache,
	saveModelCache,
} from "../index.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function clearCache() {
	try {
		const file = Bun.file(CACHE_FILE);
		if (await file.exists()) {
			await file.delete();
		}
	} catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/*  Heuristics tests                                                   */
/* ------------------------------------------------------------------ */

describe("guessInput", () => {
	test("returns [text, image] for vision keywords", () => {
		for (const kw of VISION_KEYWORDS) {
			expect(guessInput(`model-${kw}-test`)).toEqual(["text", "image"]);
		}
	});

	test("returns [text] for plain model ids", () => {
		expect(guessInput("llama3.3")).toEqual(["text"]);
		expect(guessInput("qwen2.5-coder")).toEqual(["text"]);
		expect(guessInput("deepseek-v3.1:671b")).toEqual(["text"]);
	});

	test("is case-insensitive", () => {
		expect(guessInput("Qwen2.5-VL")).toEqual(["text", "image"]);
		expect(guessInput("LLaVa-7b")).toEqual(["text", "image"]);
	});
});

describe("guessReasoning", () => {
	test("returns true for reasoning keywords", () => {
		for (const kw of REASONING_KEYWORDS) {
			expect(guessReasoning(`model-${kw}-test`)).toBe(true);
		}
	});

	test("returns false for non-reasoning models", () => {
		expect(guessReasoning("llama3.3")).toBe(false);
		expect(guessReasoning("qwen2.5")).toBe(false);
		expect(guessReasoning("gemma4")).toBe(false);
	});

	test("detects deepseek-v4 variants", () => {
		expect(guessReasoning("deepseek-v4-pro")).toBe(true);
		expect(guessReasoning("deepseek-v4-flash")).toBe(true);
		expect(guessReasoning("deepseek-v3.1")).toBe(false);
	});
});

describe("guessContextWindow", () => {
	test("returns 256_000 for kimi-k2 family", () => {
		expect(guessContextWindow("kimi-k2:1t")).toBe(256_000);
		expect(guessContextWindow("kimi-k2.5")).toBe(256_000);
		expect(guessContextWindow("kimi-k2.6")).toBe(256_000);
	});

	test("returns 128_000 for everything else", () => {
		expect(guessContextWindow("llama3.3")).toBe(128_000);
		expect(guessContextWindow("qwen3.5:397b")).toBe(128_000);
		expect(guessContextWindow("deepseek-v4-pro")).toBe(128_000);
	});
});

/* ------------------------------------------------------------------ */
/*  Config builder tests                                                 */
/* ------------------------------------------------------------------ */

const DUMMY_MODELS = [
	{ id: "llama3.3", name: "Llama 3.3", contextWindow: 128_000, maxTokens: 16_384, reasoning: false, input: ["text"] as ("text" | "image")[] },
	{ id: "qwen3-vl:72b", name: "Qwen 3 VL", contextWindow: 128_000, maxTokens: 16_384, reasoning: false, input: ["text", "image"] as ("text" | "image")[] },
	{ id: "deepseek-r1", name: "DeepSeek R1", contextWindow: 128_000, maxTokens: 16_384, reasoning: true, input: ["text"] as ("text" | "image")[] },
];

describe("buildModelConfigs", () => {
	test("produces correct number of entries", () => {
		const configs = buildModelConfigs(DUMMY_MODELS);
		expect(configs).toHaveLength(3);
	});

	test("maps fields correctly", () => {
		const [first] = buildModelConfigs(DUMMY_MODELS);
		expect(first.id).toBe("llama3.3");
		expect(first.name).toBe("Llama 3.3");
		expect(first.api).toBe("openai-completions");
		expect(first.reasoning).toBe(false);
		expect(first.input).toEqual(["text"]);
		expect(first.contextWindow).toBe(128_000);
		expect(first.maxTokens).toBe(16_384);
	});

	test("marks vision models correctly", () => {
		const configs = buildModelConfigs(DUMMY_MODELS);
		const vision = configs.find((c) => c.id === "qwen3-vl:72b");
		expect(vision?.input).toEqual(["text", "image"]);
	});

	test("marks reasoning models correctly", () => {
		const configs = buildModelConfigs(DUMMY_MODELS);
		const reasoning = configs.find((c) => c.id === "deepseek-r1");
		expect(reasoning?.reasoning).toBe(true);
	});

	test("sets compat flags for Ollama", () => {
		const [first] = buildModelConfigs(DUMMY_MODELS);
		expect(first.compat).toEqual({
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
		});
	});

	test("cost is zeroed", () => {
		const [first] = buildModelConfigs(DUMMY_MODELS);
		expect(first.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	});
});

describe("buildProviderConfig", () => {
	test("includes correct API settings", () => {
		const config = buildProviderConfig(DUMMY_MODELS);
		expect(config.baseUrl).toBe("https://ollama.com/v1");
		expect(config.api).toBe("openai-completions");
		expect(config.authHeader).toBe(true);
	});

	test("includes envApiKey when provided", () => {
		const config = buildProviderConfig(DUMMY_MODELS, "OLLAMA_CLOUD_API_KEY");
		expect(config.apiKey).toBe("OLLAMA_CLOUD_API_KEY");
	});

	test("omits apiKey when not provided", () => {
		const config = buildProviderConfig(DUMMY_MODELS);
		expect(config.apiKey).toBeUndefined();
	});

	test("includes OAuth login config", () => {
		const config = buildProviderConfig(DUMMY_MODELS);
		expect(config.oauth).toBeDefined();
		expect(config.oauth?.name).toBe("Ollama Cloud");
		expect(typeof config.oauth?.login).toBe("function");
		expect(typeof config.oauth?.refreshToken).toBe("function");
		expect(typeof config.oauth?.getApiKey).toBe("function");
	});

	test("OAuth getApiKey returns access token", () => {
		const config = buildProviderConfig(DUMMY_MODELS);
		const creds = { access: "sk-test", refresh: "sk-test", expires: Date.now() };
		expect(config.oauth?.getApiKey(creds)).toBe("sk-test");
	});
});

/* ------------------------------------------------------------------ */
/*  Cache tests                                                        */
/* ------------------------------------------------------------------ */

describe("model cache", () => {
	beforeEach(async () => {
		await clearCache();
	});

	test("save and load round-trip", async () => {
		expect(await loadModelCache()).toBeNull();
		await saveModelCache(DUMMY_MODELS);
		const loaded = await loadModelCache();
		expect(loaded).toEqual(DUMMY_MODELS);
	});

	test("returns null for missing cache", async () => {
		expect(await loadModelCache()).toBeNull();
	});

	test("returns null for invalid cache content", async () => {
		await Bun.write(CACHE_FILE, JSON.stringify([{ not_a_model: true }]));
		expect(await loadModelCache()).toBeNull();
	});
});

/* ------------------------------------------------------------------ */
/*  Extension integration tests                                        */
/* ------------------------------------------------------------------ */

describe("ollamaCloudExtension registration", () => {
	beforeEach(async () => {
		await clearCache();
	});

	test("registers provider on init (fallback when no cache)", async () => {
		const providers: string[] = [];
		const pi = {
			on: () => {},
			registerProvider: (name: string) => providers.push(name),
			registerCommand: () => {},
		} as unknown as ExtensionAPI;

		const { default: ext } = await import("../index.js");
		await ext(pi);
		expect(providers).toContain("ollama-cloud");
	});

	test("registers ollama-refresh command", async () => {
		const commands: string[] = [];
		const pi = {
			on: () => {},
			registerProvider: () => {},
			registerCommand: (name: string) => commands.push(name),
		} as unknown as ExtensionAPI;

		const { default: ext } = await import("../index.js");
		await ext(pi);
		expect(commands).toContain("ollama-refresh");
	});

	test("registers session_start and session_shutdown handlers", async () => {
		const events: string[] = [];
		const pi = {
			on: (event: string) => events.push(event),
			registerProvider: () => {},
			registerCommand: () => {},
		} as unknown as ExtensionAPI;

		const { default: ext } = await import("../index.js");
		await ext(pi);
		expect(events).toContain("session_start");
		expect(events).toContain("session_shutdown");
	});

	test("does not re-register provider when model list is unchanged", async () => {
		await clearCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ models: [{ name: "llama-test" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as any;

		let callCount = 0;
		const commands: Record<string, { description: string; handler: (args: string, ctx: any) => void | Promise<void> }> = {};
		const pi = {
			on: () => {},
			registerProvider: () => {
				callCount++;
			},
			registerCommand: (name: string, options: { description: string; handler: (args: string, ctx: any) => void | Promise<void> }) => {
				commands[name] = options;
			},
		} as unknown as ExtensionAPI;

		try {
			// Cache is empty → fallback defaults registered first, then live models from mock.
			const { default: ext } = await import(`../index.js?ts=${Date.now()}`);
			await ext(pi);
			expect(callCount).toBe(2);

			const handler = commands["ollama-refresh"]?.handler;
			expect(handler).toBeDefined();
			await handler!("", { ui: { notify: () => {} } });

			// Same model list returned by mock fetch — should NOT trigger another registerProvider
			expect(callCount).toBe(2);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("re-registers provider when model list changes", async () => {
		await clearCache();

		const originalFetch = globalThis.fetch;
		let fetchCount = 0;
		globalThis.fetch = ((async () => {
			fetchCount++;
			const models = fetchCount === 1
				? [{ name: "model-a" }]
				: [{ name: "model-a" }, { name: "model-b" }];
			return new Response(JSON.stringify({ models }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as any);

		let callCount = 0;
		const commands: Record<string, { description: string; handler: (args: string, ctx: any) => void | Promise<void> }> = {};
		const pi = {
			on: () => {},
			registerProvider: () => {
				callCount++;
			},
			registerCommand: (name: string, options: { description: string; handler: (args: string, ctx: any) => void | Promise<void> }) => {
				commands[name] = options;
			},
		} as unknown as ExtensionAPI;

		try {
			const { default: ext } = await import(`../index.js?ts=${Date.now() + 1}`);
			await ext(pi);
			// 1x fallback models + 1x live models from mock (different list)
			expect(callCount).toBe(2);

			const handler = commands["ollama-refresh"]?.handler;
			await handler!("", { ui: { notify: () => {} } });

			// Live model list changed (model-b added) — should trigger another registerProvider
			expect(callCount).toBe(3);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("loads from cache before falling back to defaults", async () => {
		await clearCache();
		await saveModelCache(DUMMY_MODELS);

		// Mock fetch so no live refresh overwrites the cache result.
		const originalFetch = globalThis.fetch;		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ models: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as any;

		let providerModelsCount = 0;
		const pi = {
			on: () => {},
			registerProvider: (_id: string, config: any) => {
				providerModelsCount = config.models?.length ?? 0;
			},
			registerCommand: () => {},
		} as unknown as ExtensionAPI;

		try {
			const { default: ext } = await import(`../index.js?ts=${Date.now() + 2}`);
			await ext(pi);
			// Should have used the cached 3 models, and since live fetch returns empty,
			// it should stay at 3.
			expect(providerModelsCount).toBe(3);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
