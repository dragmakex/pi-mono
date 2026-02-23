/**
 * Approval Mode Extension
 *
 * Presents one startup choice:
 * - "Enable everything": allow all tool calls
 * - "Approve everything": require confirmation for every tool call
 *
 * State is persisted in session custom entries and restored on reload/tree navigation.
 */

import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@mariozechner/pi-coding-agent";

type ApprovalMode = "allow-all" | "approve-all";

interface ApprovalModeState {
	mode: ApprovalMode;
}

const STATE_ENTRY_TYPE = "approval-mode-state";

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "(missing command)";
		return `command: ${command}`;
	}
	if (toolName === "write") {
		const filePath = typeof input.filePath === "string" ? input.filePath : "(missing filePath)";
		return `filePath: ${filePath}`;
	}
	if (toolName === "edit") {
		const filePath = typeof input.filePath === "string" ? input.filePath : "(missing filePath)";
		return `filePath: ${filePath}`;
	}
	if (toolName === "read") {
		const filePath = typeof input.filePath === "string" ? input.filePath : "(missing filePath)";
		return `filePath: ${filePath}`;
	}
	return JSON.stringify(input, null, 2);
}

function modeStatusText(ctx: ExtensionContext, mode: ApprovalMode | undefined): string | undefined {
	if (!mode) return undefined;
	if (mode === "allow-all") {
		return ctx.ui.theme.fg("dim", "approval: allow all");
	}
	return ctx.ui.theme.fg("warning", "approval: confirm each tool");
}

export default function approvalModeExtension(pi: ExtensionAPI): void {
	let mode: ApprovalMode | undefined;

	function persistMode(): void {
		if (!mode) return;
		pi.appendEntry<ApprovalModeState>(STATE_ENTRY_TYPE, { mode });
	}

	function restoreModeFromBranch(ctx: ExtensionContext): void {
		let restored: ApprovalMode | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
			const data = entry.data as ApprovalModeState | undefined;
			if (data?.mode === "allow-all" || data?.mode === "approve-all") {
				restored = data.mode;
			}
		}
		mode = restored ?? mode;
		ctx.ui.setStatus("approval-mode", modeStatusText(ctx, mode));
	}

	async function ensureModeSelected(ctx: ExtensionContext): Promise<void> {
		if (mode) {
			ctx.ui.setStatus("approval-mode", modeStatusText(ctx, mode));
			return;
		}

		if (!ctx.hasUI) {
			mode = "approve-all";
			persistMode();
			return;
		}

		const allowAll = await ctx.ui.confirm(
			"Permission mode",
			"Enable everything (no per-tool confirmations)?\n\nYes = allow all\nNo = ask for each tool call",
		);

		mode = allowAll ? "allow-all" : "approve-all";
		persistMode();
		ctx.ui.setStatus("approval-mode", modeStatusText(ctx, mode));
	}

	function getEventInput(event: ToolCallEvent): Record<string, unknown> {
		return event.input as Record<string, unknown>;
	}

	pi.registerCommand("approval-mode", {
		description: "Switch between allow-all and approve-all tool permissions",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("No interactive UI available", "warning");
				return;
			}

			const allowAll = await ctx.ui.confirm(
				"Permission mode",
				"Enable everything (no per-tool confirmations)?\n\nYes = allow all\nNo = ask for each tool call",
			);
			mode = allowAll ? "allow-all" : "approve-all";
			persistMode();
			ctx.ui.setStatus("approval-mode", modeStatusText(ctx, mode));
			ctx.ui.notify(`Permission mode set to ${mode}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreModeFromBranch(ctx);
		if (mode) {
			ctx.ui.setStatus("approval-mode", modeStatusText(ctx, mode));
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreModeFromBranch(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		restoreModeFromBranch(ctx);
	});

	pi.on("input", async (_event, ctx) => {
		if (!mode) {
			await ensureModeSelected(ctx);
		}
		return { action: "continue" };
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!mode) {
			await ensureModeSelected(ctx);
		}

		if (mode !== "approve-all") return undefined;

		if (!ctx.hasUI) {
			return { block: true, reason: "Tool call blocked (approve-all mode requires interactive confirmation)" };
		}

		const input = getEventInput(event);
		const confirmed = await ctx.ui.confirm(
			"Approve tool call?",
			`Tool: ${event.toolName}\n${formatToolInput(event.toolName, input)}`,
		);

		if (!confirmed) {
			return { block: true, reason: `Blocked by user (tool: ${event.toolName})` };
		}

		return undefined;
	});
}
