/**
 * Permissions Extension
 *
 * Presents one startup choice:
 * - "Ask": require confirmation for every tool call
 * - "Allow all": allow all tool calls
 *
 * State is persisted in session custom entries and restored on reload/tree navigation.
 */

import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@mariozechner/pi-coding-agent";

type PermissionMode = "allow-all" | "approve-all";

interface PermissionModeState {
	mode: PermissionMode;
}

const STATE_ENTRY_TYPE = "permissions-state";
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

function modeStatusText(ctx: ExtensionContext, mode: PermissionMode | undefined): string | undefined {
	if (!mode) return undefined;
	if (mode === "allow-all") {
		return ctx.ui.theme.fg("dim", "permissions: allow all");
	}
	return ctx.ui.theme.fg("warning", "permissions: ask");
}

async function selectPermissionMode(ctx: ExtensionContext): Promise<PermissionMode> {
	const choice = await ctx.ui.select("Permission mode", ["Ask", "Allow all"]);
	return choice === "Allow all" ? "allow-all" : "approve-all";
}

export default function permissionsExtension(pi: ExtensionAPI): void {
	let mode: PermissionMode | undefined;
	let followUpApprovalUntil = 0;

	function persistMode(): void {
		if (!mode) return;
		pi.appendEntry<PermissionModeState>(STATE_ENTRY_TYPE, { mode });
	}

	function restoreModeFromBranch(ctx: ExtensionContext): void {
		let restored: PermissionMode | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
			const data = entry.data as PermissionModeState | undefined;
			if (data?.mode === "allow-all" || data?.mode === "approve-all") {
				restored = data.mode;
			}
		}
		mode = restored ?? mode;
		ctx.ui.setStatus("permissions", modeStatusText(ctx, mode));
	}

	async function ensureModeSelected(ctx: ExtensionContext): Promise<void> {
		if (mode) {
			ctx.ui.setStatus("permissions", modeStatusText(ctx, mode));
			return;
		}

		if (!ctx.hasUI) {
			mode = "approve-all";
			persistMode();
			return;
		}

		mode = await selectPermissionMode(ctx);
		persistMode();
		ctx.ui.setStatus("permissions", modeStatusText(ctx, mode));
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

	pi.registerCommand("permissions", {
		description: "Switch between Ask and Allow all tool permissions",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("No interactive UI available", "warning");
				return;
			}

			mode = await selectPermissionMode(ctx);
			persistMode();
			ctx.ui.setStatus("permissions", modeStatusText(ctx, mode));
			ctx.ui.notify(`Permission mode set to ${mode}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreModeFromBranch(ctx);
		if (mode) {
			ctx.ui.setStatus("permissions", modeStatusText(ctx, mode));
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
		const confirmed = await ctx.ui.confirm(
			`Approve tool call?\nTool: ${event.toolName}\n${formatToolInput(event.toolName, input)}`,
			true,
		);

		if (!confirmed) {
			return { block: true, reason: `Blocked by user (tool: ${event.toolName})` };
		}

		armFollowUpApproval();
		return undefined;
	});
}
