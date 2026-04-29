import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const NOTIFICATION_GROUP = "pi-needs-input";
const DEFAULT_TITLE = "pi";
const DEFAULT_SOUND = "default";

function getTerminalBundleId(): string | undefined {
	const override = process.env.PI_NOTIFY_ACTIVATE_BUNDLE_ID;
	if (override && override.trim().length > 0) return override.trim();

	switch (process.env.TERM_PROGRAM) {
		case "Apple_Terminal":
			return "com.apple.Terminal";
		case "iTerm.app":
			return "com.googlecode.iterm2";
		case "WezTerm":
			return "com.github.wez.wezterm";
		case "vscode":
			return "com.microsoft.VSCode";
		default:
			return undefined;
	}
}

interface NotifyResult {
	args: string[];
	code: number;
	stderr: string;
	stdout: string;
}

async function notify(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	message: string,
	subtitle?: string,
): Promise<NotifyResult> {
	const args = [
		"-title",
		process.env.PI_NOTIFY_TITLE || DEFAULT_TITLE,
		"-message",
		message,
		"-group",
		NOTIFICATION_GROUP,
		"-sound",
		process.env.PI_NOTIFY_SOUND || DEFAULT_SOUND,
		"-ignoreDnD",
	];

	if (subtitle) {
		args.push("-subtitle", subtitle);
	}

	const bundleId = getTerminalBundleId();
	if (bundleId) {
		args.push("-sender", bundleId, "-activate", bundleId);
	}

	const result = await pi.exec("terminal-notifier", args, { cwd: ctx.cwd, signal: ctx.signal });
	return {
		args,
		code: result.code,
		stderr: result.stderr,
		stdout: result.stdout,
	};
}

export default function (pi: ExtensionAPI) {
	let agentStartedAt: number | undefined;
	let warnedAboutFailure = false;

	pi.on("agent_start", () => {
		agentStartedAt = Date.now();
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (ctx.hasPendingMessages()) return;

		const elapsedMs = agentStartedAt === undefined ? undefined : Date.now() - agentStartedAt;
		agentStartedAt = undefined;

		const assistantMessages = event.messages.filter((message) => message.role === "assistant");
		if (assistantMessages.length === 0) return;

		const elapsedSuffix = elapsedMs === undefined ? "" : ` after ${(elapsedMs / 1000).toFixed(1)}s`;
		const result = await notify(pi, ctx, "pi is done and waiting for your input", `Completed${elapsedSuffix}`);

		if (result.code !== 0 && !warnedAboutFailure) {
			warnedAboutFailure = true;
			ctx.ui.notify("terminal-notifier failed. Install with: brew install terminal-notifier", "error");
		}
	});

	pi.registerCommand("notify-test", {
		description: "Send a test macOS notification via terminal-notifier",
		handler: async (_args, ctx) => {
			const result = await notify(pi, ctx, "Test notification from pi", "Click to return to your terminal");
			if (result.code !== 0) {
				ctx.ui.notify(
					`terminal-notifier failed (${result.code}). stderr: ${result.stderr || "none"}`,
					"error",
				);
				return;
			}

			ctx.ui.notify(
				`terminal-notifier exited 0. If no macOS banner appeared, enable notifications for your terminal/terminal-notifier in System Settings. Args: ${result.args.join(" ")}`,
				"info",
			);
		},
	});
}
