/**
 * Runtime Uptime Extension
 *
 * Shows how long pi has been running in the footer status area.
 * Also provides /uptime command to show the current runtime.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
		.toString()
		.padStart(2, "0")}`;
}

function renderStatus(ctx: ExtensionContext, startTimeMs: number): void {
	const elapsed = formatDuration(Date.now() - startTimeMs);
	const text = ctx.ui.theme.fg("dim", `uptime ${elapsed}`);
	ctx.ui.setStatus("runtime-uptime", text);
}

export default function runtimeUptimeExtension(pi: ExtensionAPI): void {
	const startTimeMs = Date.now();
	let timer: ReturnType<typeof setInterval> | undefined;

	function stopTimer(): void {
		if (!timer) return;
		clearInterval(timer);
		timer = undefined;
	}

	function startTimer(ctx: ExtensionContext): void {
		stopTimer();
		renderStatus(ctx, startTimeMs);
		timer = setInterval(() => {
			renderStatus(ctx, startTimeMs);
		}, 1000);
	}

	pi.registerCommand("uptime", {
		description: "Show how long pi has been running",
		handler: async (_args, ctx) => {
			const elapsed = formatDuration(Date.now() - startTimeMs);
			ctx.ui.notify(`pi runtime: ${elapsed}`, "info");
			renderStatus(ctx, startTimeMs);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		startTimer(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		startTimer(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stopTimer();
		ctx.ui.setStatus("runtime-uptime", undefined);
	});
}
