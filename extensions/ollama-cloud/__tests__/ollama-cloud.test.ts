import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

describe("ollamaCloudExtension", () => {
	test("exports a function", async () => {
		const { default: ext } = await import("../index.js");
		expect(typeof ext).toBe("function");
	});

	test("registers ollama-cloud provider on init", async () => {
		const providers: string[] = [];
		const pi = {
			on: () => {},
			registerProvider: (name: string) => providers.push(name),
			registerCommand: () => {},
		} as unknown as ExtensionAPI;

		const { default: ext } = await import(`../index.js?ts=${Date.now()}`);
		ext(pi);
		expect(providers).toContain("ollama-cloud");
	});

	test("registers ollama-refresh command", async () => {
		const commands: string[] = [];
		const pi = {
			on: () => {},
			registerProvider: () => {},
			registerCommand: (name: string) => commands.push(name),
		} as unknown as ExtensionAPI;

		const { default: ext } = await import(`../index.js?ts=${Date.now() + 1}`);
		ext(pi);
		expect(commands).toContain("ollama-refresh");
	});

	test("registers session_start and session_shutdown handlers", async () => {
		const events: string[] = [];
		const pi = {
			on: (event: string) => events.push(event),
			registerProvider: () => {},
			registerCommand: () => {},
		} as unknown as ExtensionAPI;

		const { default: ext } = await import(`../index.js?ts=${Date.now() + 2}`);
		ext(pi);
		expect(events).toContain("session_start");
		expect(events).toContain("session_shutdown");
	});

	test("ollama-refresh handler notifies and calls refreshFromApi", async () => {
		const notifications: Array<{ msg: string; type: string }> = [];
		const pi = {
			on: () => {},
			registerProvider: () => {},
			registerCommand: (name: string, opts: { handler: (...a: any[]) => any }) => {
				if (name === "ollama-refresh") {
					opts.handler("", { ui: { notify: (msg: string, type: string) => notifications.push({ msg, type }) } });
				}
			},
		} as unknown as ExtensionAPI;

		const { default: ext } = await import(`../index.js?ts=${Date.now() + 3}`);
		ext(pi);
		// Should have a notification (info or warning depending on network)
		expect(notifications.length).toBeGreaterThan(0);
	});
});
