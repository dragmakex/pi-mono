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
const FOLLOW_UP_APPROVAL_WINDOW_MS = 1200;

function getStringValue(input: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value;
		}
	}
	return undefined;
}

function getNumberValue(input: Record<string, unknown>, keys: string[]): number | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}
	return undefined;
}

function getBooleanValue(input: Record<string, unknown>, keys: string[]): boolean | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "boolean") {
			return value;
		}
	}
	return undefined;
}

function formatFields(fields: Array<[label: string, value: string | number | boolean | undefined]>): string {
	const lines = fields
		.filter(([, value]) => value !== undefined)
		.map(([label, value]) => `${label}: ${String(value)}`);
	return lines.length > 0 ? lines.join("\n") : "(no tool arguments)";
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
	if (toolName === "bash") {
		return formatFields([
			["command", getStringValue(input, ["command", "cmd"]) ?? "(missing command)"],
			["cwd", getStringValue(input, ["cwd", "workingDirectory", "working_directory"])],
		]);
	}
	if (toolName === "write") {
		return formatFields([
			["filePath", getStringValue(input, ["filePath", "file_path", "path"]) ?? "(missing filePath)"],
			["append", getBooleanValue(input, ["append"])],
		]);
	}
	if (toolName === "edit") {
		return formatFields([
			["filePath", getStringValue(input, ["filePath", "file_path", "path"]) ?? "(missing filePath)"],
			["oldText", getStringValue(input, ["oldText", "old_text"])],
			["newText", getStringValue(input, ["newText", "new_text"])],
			["replaceAll", getBooleanValue(input, ["replaceAll", "replace_all"])],
		]);
	}
	if (toolName === "read") {
		return formatFields([
			["filePath", getStringValue(input, ["filePath", "file_path", "path"]) ?? "(missing filePath)"],
			["offset", getNumberValue(input, ["offset"])],
			["limit", getNumberValue(input, ["limit"])],
		]);
	}
	if (toolName === "grep") {
		return formatFields([
			["pattern", getStringValue(input, ["pattern"])],
			["path", getStringValue(input, ["path", "filePath", "file_path"])],
			["include", getStringValue(input, ["include"])],
		]);
	}
	if (toolName === "find") {
		return formatFields([
			["path", getStringValue(input, ["path", "filePath", "file_path"])],
			["pattern", getStringValue(input, ["pattern"])],
		]);
	}
	if (toolName === "ls") {
		return formatFields([
			["path", getStringValue(input, ["path", "filePath", "file_path"])],
			["depth", getNumberValue(input, ["depth"])],
		]);
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

async function selectYesNo(ctx: ExtensionContext, title: string, message: string): Promise<boolean> {
	const choice = await ctx.ui.select(`${title}\n${message}`, ["No", "Yes"]);
	return choice === "Yes";
}

export default function approvalModeExtension(pi: ExtensionAPI): void {
	let mode: ApprovalMode | undefined;
	let followUpApprovalUntil = 0;

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

		const allowAll = await selectYesNo(
			ctx,
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

	function shouldAutoApproveFollowUp(): boolean {
		const now = Date.now();
		if (followUpApprovalUntil <= now) return false;
		followUpApprovalUntil = 0;
		return true;
	}

	function armFollowUpApproval(): void {
		followUpApprovalUntil = Date.now() + FOLLOW_UP_APPROVAL_WINDOW_MS;
	}

	pi.registerCommand("approval-mode", {
		description: "Switch between allow-all and approve-all tool permissions",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("No interactive UI available", "warning");
				return;
			}

			const allowAll = await selectYesNo(
				ctx,
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

		if (shouldAutoApproveFollowUp()) {
			return undefined;
		}

		const input = getEventInput(event);
		const confirmed = await selectYesNo(
			ctx,
			"Approve tool call?",
			`Tool: ${event.toolName}\n${formatToolInput(event.toolName, input)}`,
		);

		if (!confirmed) {
			return { block: true, reason: `Blocked by user (tool: ${event.toolName})` };
		}

		armFollowUpApproval();
		return undefined;
	});
}
