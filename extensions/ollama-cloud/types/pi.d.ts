/**
 * Minimal ambient type stubs for the pi / tallow host framework.
 * These declarations satisfy the TypeScript compiler so that
 * `tsc --noEmit` passes without the actual host packages installed.
 */

declare module "@mariozechner/pi-coding-agent" {
	type ExtensionEvent = "session_start" | "session_shutdown" | string;

	export interface ExtensionCommandContext {
		ui: {
			notify(message: string, type: "info" | "warning" | "error" | "success"): void;
		};
	}

	export interface ExtensionAPI {
		on(event: ExtensionEvent, callback: (...args: any[]) => void): void;
		registerProvider(id: string, config: any): void;
		registerCommand(
			name: string,
			options: {
				description: string;
				handler: (args: string, ctx: ExtensionCommandContext) => void | Promise<void>;
			}
		): void;
	}
}

declare module "@mariozechner/pi-ai" {
	export type Api = "openai-completions" | string;

	export interface OpenAICompletionsCompat {
		supportsDeveloperRole: boolean;
		supportsReasoningEffort: boolean;
	}

	export interface OAuthCredentials {
		access: string;
		refresh: string;
		expires: number;
	}

	export interface OAuthLoginCallbacks {
		onPrompt(opts: { message: string }): Promise<string>;
	}

	export interface OAuthLoginConfig {
		name: string;
		login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
		refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
		getApiKey(credentials: OAuthCredentials): string;
	}
}
