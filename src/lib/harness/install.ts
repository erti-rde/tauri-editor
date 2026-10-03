import { mockConvertFileSrc, mockIPC, mockWindows } from '@tauri-apps/api/mocks';

import { commands } from '$lib/ipc';
import { log } from '$lib/log';

import { fakeCommands, stateFrom, type FakeCommands, type FakeState } from './fakeBackend';
import { defaultFixture, HOME, type Fixture } from './fixture';

/**
 * Put the fake backend under the app (M1a-1).
 *
 * Everything the webview asks Tauri for goes through `window.__TAURI_INTERNALS__
 * .invoke`, so replacing that one function is enough to run the real
 * `+page.svelte` in a browser or in jsdom. The generated commands go to the
 * typed fake; the plugins the app uses (store, fs, path, dialog, opener,
 * window) get small in-memory versions here.
 */

/**
 * Bundled resources, read the way the app reads them from the Resource
 * directory. Lazy: the style index alone is half a megabyte.
 */
const resources = import.meta.glob('/src-tauri/resources/csl/**/*.{json,csl,xml}', {
	query: '?raw',
	import: 'default'
}) as Record<string, () => Promise<string>>;

/** A file on the fake disk. */
type Entry = string | Uint8Array | { pdf: string };

export interface FakeBackend {
	state: FakeState;
	/** Files by absolute path; directories are implied by what's under them. */
	files: Map<string, Entry>;
	/** Directories created empty, which no file implies. */
	dirs: Set<string>;
	/** Settings stores by file name. */
	stores: Map<string, Map<string, unknown>>;
	/** What the folder and save pickers answer next, in order. */
	dialogAnswers: (string | null)[];
	/** Every call, in order: for asserting that something was (or wasn't) asked. */
	calls: { cmd: string; args: unknown }[];
	/** URLs and paths handed to the OS to open. */
	opened: string[];
	/** Commands nobody implemented. A journey fails if this isn't empty. */
	unhandled: string[];
	/** Lines written to the log file, as tauri-plugin-log would get them. */
	logs: { level: number; message: string }[];
	uninstall(): void;
}

declare global {
	interface Window {
		/** The installed fake, for Playwright to inspect. */
		__ERTI_FAKE__?: FakeBackend;
	}
}

type Internals = {
	invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
};

const internals = () =>
	(window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;

/**
 * Each generated command's IPC name and argument names, in parameter order.
 *
 * Learnt by calling every generated command once with placeholder arguments
 * and recording what reaches IPC, so the order comes from the bindings
 * themselves rather than from a second list kept by hand.
 */
function learnSignatures() {
	const signatures = new Map<string, { key: keyof FakeCommands; params: string[] }>();
	const previous = internals().invoke;
	let seen: { cmd: string; args: Record<string, unknown> } | null = null;

	internals().invoke = (cmd, args) => {
		seen = { cmd, args: (args ?? {}) as Record<string, unknown> };
		return new Promise(() => {});
	};
	try {
		for (const key of Object.keys(commands) as (keyof FakeCommands)[]) {
			const command = commands[key] as (...args: unknown[]) => unknown;
			const placeholders = Array.from({ length: command.length }, (_, i) => `\u0000${i}`);
			seen = null;
			void command(...placeholders);
			if (seen === null) throw new Error(`Fake backend: ${key} never reached IPC.`);
			const { cmd, args } = seen as { cmd: string; args: Record<string, unknown> };
			const params = Object.keys(args).sort(
				(a, b) => placeholders.indexOf(args[a] as string) - placeholders.indexOf(args[b] as string)
			);
			signatures.set(cmd, { key, params });
		}
	} finally {
		internals().invoke = previous;
	}
	return signatures;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Bytes as the fs plugin sends them: a plain array survives every realm. */
const bytes = (text: string) => Array.from(encoder.encode(text));

const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';

function joinPaths(paths: string[]): string {
	const joined = paths.filter(Boolean).join('/').replace(/\/+/g, '/');
	return normalise(joined);
}

function normalise(path: string): string {
	const out: string[] = [];
	for (const part of path.split('/')) {
		if (part === '..') out.pop();
		else if (part !== '.' && part !== '') out.push(part);
	}
	return (path.startsWith('/') ? '/' : '') + out.join('/');
}

/** Tauri's BaseDirectory values, and where each lives on the fake disk. */
const BASE_DIRS: Record<number, string> = {
	2: `${HOME}/Library/Caches`,
	3: `${HOME}/Library/Application Support`,
	4: `${HOME}/Library/Application Support`,
	5: `${HOME}/Library/Application Support`,
	6: `${HOME}/Documents`,
	7: `${HOME}/Downloads`,
	11: '/fake/Erti.app/Contents/Resources',
	12: '/fake/tmp',
	13: `${HOME}/Library/Application Support/app.erti`,
	14: `${HOME}/Library/Application Support/app.erti`,
	15: `${HOME}/Library/Application Support/app.erti`,
	16: `${HOME}/Library/Caches/app.erti`,
	17: `${HOME}/Library/Logs/app.erti`,
	18: `${HOME}/Desktop`,
	21: HOME
};
const RESOURCE = 11;

export function installFakeBackend(fixture: Fixture = defaultFixture()): FakeBackend {
	const state = stateFrom(fixture);
	const files = new Map<string, Entry>(Object.entries(fixture.files));
	const dirs = new Set<string>([fixture.root]);
	const stores = new Map(
		Object.entries(fixture.stores).map(([name, values]) => [
			name,
			new Map(Object.entries(structuredClone(values)))
		])
	);
	const storeByRid = new Map<number, string>();
	let nextRid = 1;

	const isDir = (path: string) => {
		if (dirs.has(path)) return true;
		const prefix = `${path}/`;
		for (const file of files.keys()) if (file.startsWith(prefix)) return true;
		return false;
	};
	const has = (path: string) => files.has(path) || isDir(path);

	const backend: FakeBackend = {
		state,
		files,
		dirs,
		stores,
		dialogAnswers: [...fixture.dialogAnswers],
		calls: [],
		opened: [],
		unhandled: [],
		logs: [],
		uninstall() {
			// Not `clearMocks()`: a component's async work can outlive the test that
			// started it, and a missing `invoke` would throw into whichever test runs
			// next. Late calls are left pending instead, and go nowhere.
			internals().invoke = () => new Promise(() => {});
			if (window.__ERTI_FAKE__ === backend) delete window.__ERTI_FAKE__;
		}
	};

	const typed = fakeCommands(state, {
		list: () => [...files.keys()],
		has,
		pdfUrl: (path) => {
			const entry = files.get(path);
			return entry && typeof entry === 'object' && 'pdf' in entry ? entry.pdf : undefined;
		}
	});

	/** The fs plugin's path, with `baseDir` applied. */
	const resolvePath = (path: string, options?: { baseDir?: number }) =>
		options?.baseDir === undefined ? path : joinPaths([BASE_DIRS[options.baseDir], path]);

	/** Plugin errors are plain strings, as Rust's `String` errors arrive. */
	const fsError = (path: string, what: string) =>
		`failed to ${what} ${path}: No such file or directory (os error 2)`;

	async function readBytes(path: string, options?: { baseDir?: number }): Promise<number[]> {
		if (options?.baseDir === RESOURCE) {
			const load = resources[`/src-tauri/${normalise(path)}`];
			if (!load) throw fsError(path, 'open file at path');
			return bytes(await load());
		}
		const entry = files.get(resolvePath(path, options));
		if (entry === undefined) throw fsError(path, 'open file at path');
		if (typeof entry === 'string') return bytes(entry);
		if (entry instanceof Uint8Array) return Array.from(entry);
		return Array.from(new Uint8Array(await (await fetch(entry.pdf)).arrayBuffer()));
	}

	/**
	 * `write_text_file` and `write_file`. Text is kept as text; bytes are kept as
	 * bytes, since decoding a PNG or a PDF as UTF-8 would corrupt it on the way
	 * back out.
	 */
	function write(body: unknown, headers: Record<string, string>, binary: boolean) {
		const path = decodeURIComponent(headers.path);
		const options = JSON.parse(headers.options ?? 'null') ?? {};
		const target = resolvePath(path, options);
		if (options.createNew && has(target))
			throw `failed to open file at path: ${target}: File exists (os error 17)`;
		if (!isDir(parent(target))) throw fsError(parent(target), 'open file at path');
		const data = body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer);
		const previous = files.get(target);

		if (binary) {
			const before = options.append && previous instanceof Uint8Array ? previous : new Uint8Array();
			const joined = new Uint8Array(before.length + data.length);
			joined.set(before);
			joined.set(data, before.length);
			files.set(target, joined);
		} else {
			files.set(
				target,
				options.append && typeof previous === 'string'
					? previous + decoder.decode(data)
					: decoder.decode(data)
			);
		}
		return null;
	}

	type Handler = (
		args: Record<string, unknown>,
		options?: { headers?: Record<string, string> }
	) => unknown;

	const plugins: Record<string, Handler> = {
		// Settings.
		'plugin:store|load': ({ path }) => {
			const name = String(path);
			if (!stores.has(name)) stores.set(name, new Map());
			const rid = nextRid++;
			storeByRid.set(rid, name);
			return rid;
		},
		'plugin:store|get_store': ({ path }) => {
			for (const [rid, name] of storeByRid) if (name === path) return rid;
			return null;
		},
		'plugin:store|get': ({ rid, key }) => {
			const store = stores.get(storeByRid.get(rid as number)!)!;
			const exists = store.has(key as string);
			return [exists ? structuredClone(store.get(key as string)) : null, exists];
		},
		'plugin:store|set': ({ rid, key, value }) => {
			stores.get(storeByRid.get(rid as number)!)!.set(key as string, structuredClone(value));
			return null;
		},
		'plugin:store|has': ({ rid, key }) =>
			stores.get(storeByRid.get(rid as number)!)!.has(key as string),
		'plugin:store|delete': ({ rid, key }) =>
			stores.get(storeByRid.get(rid as number)!)!.delete(key as string),
		'plugin:store|keys': ({ rid }) => [...stores.get(storeByRid.get(rid as number)!)!.keys()],
		'plugin:store|entries': ({ rid }) => [...stores.get(storeByRid.get(rid as number)!)!.entries()],
		'plugin:store|save': () => null,
		'plugin:store|reload': () => null,
		'plugin:resources|close': ({ rid }) => {
			storeByRid.delete(rid as number);
			return null;
		},

		// Files.
		'plugin:fs|read_text_file': ({ path, options }) =>
			readBytes(String(path), options as { baseDir?: number }),
		'plugin:fs|read_file': ({ path, options }) =>
			readBytes(String(path), options as { baseDir?: number }),
		'plugin:fs|write_text_file': (body, options) => write(body, options?.headers ?? {}, false),
		'plugin:fs|write_file': (body, options) => write(body, options?.headers ?? {}, true),
		'plugin:fs|exists': ({ path, options }) => {
			const opts = options as { baseDir?: number } | undefined;
			if (opts?.baseDir === RESOURCE) return `/src-tauri/${normalise(String(path))}` in resources;
			return has(resolvePath(String(path), opts));
		},
		'plugin:fs|mkdir': ({ path, options }) => {
			const target = resolvePath(String(path), options as { baseDir?: number });
			const recursive = (options as { recursive?: boolean } | undefined)?.recursive;
			if (!recursive && !isDir(parent(target))) throw fsError(target, 'create directory');
			for (let at = target; at !== '/' && at !== ''; at = parent(at)) dirs.add(at);
			return null;
		},
		'plugin:fs|remove': ({ path, options }) => {
			const target = resolvePath(String(path), options as { baseDir?: number });
			if (!has(target)) throw fsError(target, 'remove');
			files.delete(target);
			dirs.delete(target);
			return null;
		},
		'plugin:fs|rename': ({ oldPath, newPath }) => {
			const entry = files.get(String(oldPath));
			if (entry === undefined) throw fsError(String(oldPath), 'rename');
			files.delete(String(oldPath));
			files.set(String(newPath), entry);
			return null;
		},

		// Paths.
		'plugin:path|resolve_directory': ({ directory, path }) =>
			joinPaths([BASE_DIRS[directory as number] ?? HOME, (path as string) ?? '']),
		'plugin:path|join': ({ paths }) => joinPaths(paths as string[]),
		'plugin:path|resolve': ({ paths }) => joinPaths(paths as string[]),
		'plugin:path|normalize': ({ path }) => normalise(String(path)),
		'plugin:path|basename': ({ path, ext }) => {
			const base = String(path).split('/').pop() ?? '';
			return ext && base.endsWith(ext as string) ? base.slice(0, -(ext as string).length) : base;
		},
		'plugin:path|dirname': ({ path }) => parent(String(path)),
		'plugin:path|extname': ({ path }) => String(path).split('.').pop() ?? '',
		'plugin:path|is_absolute': ({ path }) => String(path).startsWith('/'),

		// Dialogs: answered from the queue, so a journey says what the user picks.
		'plugin:dialog|open': () => backend.dialogAnswers.shift() ?? null,
		'plugin:dialog|save': () => backend.dialogAnswers.shift() ?? null,
		'plugin:dialog|message': () => 'Ok',
		'plugin:dialog|ask': () => true,
		'plugin:dialog|confirm': () => true,

		// Handing things to the OS.
		'plugin:opener|open_url': ({ url }) => {
			backend.opened.push(String(url));
			return null;
		},
		'plugin:opener|open_path': ({ path }) => {
			backend.opened.push(String(path));
			return null;
		},
		'plugin:opener|reveal_item_in_dir': ({ paths }) => {
			backend.opened.push(...(paths as string[]));
			return null;
		},

		// The log file (M1a-12).
		'plugin:log|log': ({ level, message }) => {
			backend.logs.push({ level: Number(level), message: String(message) });
			return null;
		},

		// The window: closing is the only thing the app asks of it.
		'plugin:window|destroy': () => null,
		'plugin:window|close': () => null
	};

	mockWindows('main');
	mockConvertFileSrc('macos');
	// Events (the close-requested listener) are kept by Tauri's own mock.
	mockIPC(() => undefined, { shouldMockEvents: true });
	const events = internals().invoke;
	const signatures = learnSignatures();

	internals().invoke = async (cmd, args, options) => {
		backend.calls.push({ cmd, args });
		if (cmd.startsWith('plugin:event|')) return events(cmd, args, options);

		const signature = signatures.get(cmd);
		if (signature) {
			const values = (args ?? {}) as Record<string, unknown>;
			const handler = typed[signature.key] as (...a: unknown[]) => unknown;
			return handler(...signature.params.map((name) => values[name]));
		}

		const plugin = plugins[cmd];
		if (plugin) {
			return plugin(
				args as Record<string, unknown>,
				options as { headers?: Record<string, string> }
			);
		}

		// Loud, twice over: a rejection the caller may swallow, and a logged
		// error, which reaches the console the journeys fail on.
		backend.unhandled.push(cmd);
		const message = `Fake backend: no handler for "${cmd}". Add one in src/lib/harness/.`;
		log.error(message);
		throw new Error(message);
	};

	window.__ERTI_FAKE__ = backend;
	return backend;
}
