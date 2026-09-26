import {
	debug as writeDebug,
	error as writeError,
	info as writeInfo,
	warn as writeWarn
} from '@tauri-apps/plugin-log';

/**
 * Erti's one logger (M1a-12).
 *
 * Lines go to the log file tauri-plugin-log keeps in the app's log directory,
 * beside Rust's. Nothing is sent anywhere: the file is for the person to read,
 * or to attach to a bug report if they choose to.
 *
 * That's why it must never hold what they wrote. A log line is Erti's own
 * words (`message`) plus a description of what went wrong (`detail`), and only
 * the message is written as given. The detail is reduced to what diagnoses a
 * fault without repeating content: an error's name and message with quoted
 * text taken out, its first stack frames, and for anything else only its
 * shape. A string detail is never written, since it's as likely to be a
 * paragraph as a reason.
 *
 * So: `log.error('Could not save the notes', error)`, never
 * `log.error(\`Could not save ${note}\`)`. File names and paths are fine in the
 * message; the text inside the files isn't.
 */

type Level = 'error' | 'warn' | 'info' | 'debug';

const writers: Record<Level, (line: string) => Promise<void>> = {
	error: writeError,
	warn: writeWarn,
	info: writeInfo,
	debug: writeDebug
};

/** Longest a message or an error's message is written, in characters. */
const MAX_TEXT = 300;
/** Stack frames kept: enough to find the code, not a page of framework. */
const MAX_FRAMES = 5;

const cap = (text: string, max = MAX_TEXT) =>
	text.length > max ? `${text.slice(0, max)}… (${text.length} characters)` : text;

/**
 * Text in quotation marks, replaced with a mark saying it was there.
 *
 * Parsers quote the input they choke on: V8's JSON.parse says `"my chapter
 * begins…" is not valid JSON`, ProseMirror prints nodes as `paragraph("…")`.
 * A single quote only opens after a non-letter, so "couldn't" isn't one.
 */
export function withoutQuotes(text: string): string {
	return text
		.replace(/"[^"]*"/g, '"…"')
		.replace(/“[^”]*”/g, '“…”')
		.replace(/‘[^’]*’/g, '‘…’')
		.replace(/`[^`]*`/g, '`…`')
		.replace(/(^|[^\p{L}])'[^']*'/gu, "$1'…'");
}

function frames(error: Error): string {
	if (!error.stack) return '';
	// V8 starts the stack with the name and message again, unredacted.
	const head = `${error.name}: ${error.message}`;
	const stack = error.stack.startsWith(head) ? error.stack.slice(head.length) : error.stack;
	return stack
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.slice(0, MAX_FRAMES)
		.map((line) => `\n    ${cap(line, 200)}`)
		.join('');
}

function describeError(error: Error, depth: number): string {
	// `IpcError` carries Rust's error kind (ADR 011).
	const kind = 'kind' in error && typeof error.kind === 'string' ? ` [${error.kind}]` : '';
	const line = `${error.name}${kind}: ${cap(withoutQuotes(error.message))}`;
	const cause =
		error.cause !== undefined && depth < 2
			? `\n  caused by ${describe(error.cause, depth + 1)}`
			: '';
	return `${line}${frames(error)}${cause}`;
}

/** What a detail says about a fault, without what it carried. */
export function describe(detail: unknown, depth = 0): string {
	if (detail instanceof Error) return describeError(detail, depth);
	if (detail === null || detail === undefined) return String(detail);
	if (typeof detail === 'string') return `(text, ${detail.length} characters, not logged)`;
	if (typeof detail !== 'object') return String(detail);
	// Rust's `AppError` as it arrives from a command, before `call` wraps it.
	const { kind, message } = detail as { kind?: unknown; message?: unknown };
	if (typeof kind === 'string' && typeof message === 'string') {
		return `AppError [${kind}]: ${cap(withoutQuotes(message))}`;
	}
	if (Array.isArray(detail)) return `(array of ${detail.length})`;
	const keys = Object.keys(detail).slice(0, 10);
	return `(object with ${keys.length ? keys.join(', ') : 'no keys'})`;
}

/** The line as written: the message, then the detail if there is one. */
export function formatLine(message: string, detail?: unknown): string {
	const text = cap(message);
	return arguments.length < 2 ? text : `${text}: ${describe(detail)}`;
}

function write(level: Level, message: string, rest: unknown[]) {
	const line = rest.length ? formatLine(message, rest[0]) : formatLine(message);
	// Only where there's no log file to read: `pnpm dev` and the harness. Never
	// in tests, where the failures being logged are the ones being tested.
	if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
		// eslint-disable-next-line no-console -- the one place that may.
		console[level](line, ...rest);
	}
	// A log that can't be written has nowhere to say so.
	writers[level](line).catch(() => {});
}

export const log = {
	error: (message: string, ...detail: [unknown?]) => write('error', message, detail),
	warn: (message: string, ...detail: [unknown?]) => write('warn', message, detail),
	info: (message: string, ...detail: [unknown?]) => write('info', message, detail),
	debug: (message: string, ...detail: [unknown?]) => write('debug', message, detail)
};

/** How long a repeated fault stays collapsed into the toast already showing. */
const REPEAT_WINDOW_MS = 5000;

/** Not faults: browsers raise these for things that went right in the end. */
const BENIGN = [/^ResizeObserver loop/, /^Script error\.?$/];

/**
 * Anything thrown that nothing caught: logged, and said once (M1a-12 AC-3).
 *
 * Until now an unexpected error went to a console nobody has open, and the app
 * carried on as if nothing had happened. Now it says so, and where to look.
 * The same fault repeating (an error in a redraw can fire every frame) is one
 * toast and one log line until it has been quiet for a few seconds.
 *
 * Returns a function that removes the handlers.
 */
export function catchUnhandled(
	target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
	show: (message: string) => void,
	now: () => number = Date.now
): () => void {
	const lastSeen = new Map<string, number>();

	const report = (what: string, thrown: unknown) => {
		// Words for the toast: an error's own message, or nothing to go on.
		const reason =
			thrown instanceof Error ? thrown.message : typeof thrown === 'string' ? thrown : '';
		if (BENIGN.some((pattern) => pattern.test(reason))) return;

		const key = `${what}\u0000${reason || describe(thrown)}`;
		const seen = lastSeen.get(key);
		lastSeen.set(key, now());
		if (seen !== undefined && now() - seen < REPEAT_WINDOW_MS) return;

		log.error(what, thrown);
		const said = reason
			.split('\n')[0]
			.trim()
			.replace(/[.:;,\s]+$/, '');
		show(
			said
				? `Something went wrong: ${cap(said, 160)}. Details are in the log.`
				: 'Something went wrong. Details are in the log.'
		);
	};

	const onError = (event: Event) => {
		const { error, message } = event as ErrorEvent;
		report('Uncaught error', error ?? new Error(message));
	};
	const onRejection = (event: Event) => {
		report('Unhandled promise rejection', (event as PromiseRejectionEvent).reason);
	};

	target.addEventListener('error', onError);
	target.addEventListener('unhandledrejection', onRejection);
	return () => {
		target.removeEventListener('error', onError);
		target.removeEventListener('unhandledrejection', onRejection);
	};
}
