import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	VISION_KEYWORDS,
	REASONING_KEYWORDS,
	guessInput,
	guessReasoning,
	guessContextWindow,
	buildModelConfigs,
	buildProviderConfig,
} from "../index.js";

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
/*  Extension integration tests                                        */
/* ------------------------------------------------------------------ */

describe("ollamaCloudExtension registration", () => {
	test("registers provider on init", async () => {
		const providers: string[] = [];
		const pi = {
			on: () => {},
			registerProvider: (name: string) => providers.push(name),
			registerCommand: () => {},
		} as unknown as ExtensionAPI;

		// We can't easily mock fetch in a dynamic import, so we check
		// that the module loads and can be invoked.  In production,
		// fetchOllamaModels() will hit the real registry or fall back.
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
});
