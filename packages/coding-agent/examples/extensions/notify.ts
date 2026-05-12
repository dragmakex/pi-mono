/**
 * Pi Notify Extension
 *
 * Sends a terminal-native notification when Pi is done and waiting for input.
 * Only emits OSC sequences for terminals that explicitly support them.
 * Unsupported terminals are ignored instead of receiving raw escape codes.
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const ESC = "\x1b";
const BEL = "\x07";
const ST = `${ESC}\\`;

type NotificationTerminal = "ghostty" | "iterm2" | "kitty" | "windows-terminal";

function sanitizeOscText(text: string): string {
	return text
		.replace(/[\x07\x1b\x9c\r\n]+/g, " ")
		.replaceAll(";", ":")
		.trim();
}

function wrapForMultiplexer(sequence: string): string {
	if (process.env.TMUX) {
		return `${ESC}Ptmux;${sequence.replaceAll(ESC, `${ESC}${ESC}`)}${ST}`;
	}
	if (process.env.STY) {
		return `${ESC}P${sequence}${ST}`;
	}
	return sequence;
}

function detectTerminal(): NotificationTerminal | null {
	if (process.env.WT_SESSION) {
		return "windows-terminal";
	}

	const termProgram = process.env.TERM_PROGRAM?.toLowerCase();
	const lcTerminal = process.env.LC_TERMINAL?.toLowerCase();
	const term = process.env.TERM?.toLowerCase();

	if (term === "xterm-ghostty" || termProgram === "ghostty") {
		return "ghostty";
	}
	if (process.env.ITERM_SESSION_ID || lcTerminal === "iterm2" || termProgram === "iterm.app") {
		return "iterm2";
	}
	if (process.env.KITTY_WINDOW_ID || termProgram === "kitty" || term?.includes("kitty")) {
		return "kitty";
	}

	return null;
}

function windowsToastScript(title: string, body: string): string {
	const escapedTitle = title.replaceAll("'", "''");
	const escapedBody = body.replaceAll("'", "''");
	const type = "Windows.UI.Notifications";
	const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText01`;
	const toast = `[${type}.ToastNotification]::new($xml)`;
	return [
		`${mgr} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${escapedBody}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${escapedTitle}').Show(${toast})`,
	].join("; ");
}

function notifyOSC777(title: string, body: string): void {
	const safeTitle = sanitizeOscText(title);
	const safeBody = sanitizeOscText(body);
	process.stdout.write(wrapForMultiplexer(`${ESC}]777;notify;${safeTitle};${safeBody}${BEL}`));
}

function notifyOSC9(title: string, body: string): void {
	const safeTitle = sanitizeOscText(title);
	const safeBody = sanitizeOscText(body);
	const display = safeTitle ? `${safeTitle}: ${safeBody}` : safeBody;
	process.stdout.write(wrapForMultiplexer(`${ESC}]9;${display}${BEL}`));
}

function notifyOSC99(title: string, body: string): void {
	const safeTitle = sanitizeOscText(title);
	const safeBody = sanitizeOscText(body);
	const id = Math.floor(Math.random() * 10000);
	process.stdout.write(wrapForMultiplexer(`${ESC}]99;i=${id}:d=0:p=title;${safeTitle}${ST}`));
	process.stdout.write(wrapForMultiplexer(`${ESC}]99;i=${id}:p=body;${safeBody}${ST}`));
	process.stdout.write(wrapForMultiplexer(`${ESC}]99;i=${id}:d=1:a=focus;${ST}`));
}

function notifyWindows(title: string, body: string): void {
	execFile("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)], () => {
		// Ignore notification errors.
	});
}

function notify(title: string, body: string): void {
	if (!process.stdout.isTTY) {
		return;
	}

	const terminal = detectTerminal();
	switch (terminal) {
		case "windows-terminal":
			notifyWindows(title, body);
			break;
		case "kitty":
			notifyOSC99(title, body);
			break;
		case "iterm2":
			notifyOSC9(title, body);
			break;
		case "ghostty":
			notifyOSC777(title, body);
			break;
		default:
			break;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async () => {
		notify("Pi", "Ready for input");
	});
}
