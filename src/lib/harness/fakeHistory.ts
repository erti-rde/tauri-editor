import type { AppError, History, Snapshot, Trigger } from '$lib/ipc/bindings';

/**
 * Version history on the fake disk, as `history.rs` keeps it (M5-1).
 *
 * The same files in the same places (`.erti/history/<stem>/<UTC>.erti.json`,
 * with `snapshots.json` beside them) and the same rules: the ten-minute rule
 * while writing, no copy of the bytes the newest already holds, and a restore
 * that keeps the current file first. Not thinned on open: thinning starts a
 * day back, and a harness session doesn't last that long.
 */

export interface HistoryDisk {
	list(): string[];
	text(path: string): string | undefined;
	write(path: string, text: string): void;
	remove(path: string): void;
}

const EXTENSION = '.erti.json';
const INDEX = 'snapshots.json';
const WHILE_WRITING_EVERY = 10 * 60;
const DAY = 24 * 60 * 60;

/** `2026-10-13T10-24-16Z.erti.json`, as `history::name_for`. */
export function nameFor(secs: number): string {
	return `${new Date(secs * 1000).toISOString().slice(0, 19).replace(/:/g, '-')}Z${EXTENSION}`;
}

/** When a snapshot was taken, from its name, as `history::time_of_name`. */
export function timeOfName(name: string): number | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.erti\.json$/.exec(name);
	if (!match) return null;
	const [y, m, d, hh, mm, ss] = match.slice(1).map(Number);
	const secs = Date.UTC(y, m - 1, d, hh, mm, ss) / 1000;
	return nameFor(secs) === name ? secs : null;
}

const fail = (kind: AppError['kind'], message: string): AppError => ({ kind, message });
const OUTSIDE = fail(
	'PermissionDenied',
	'Erti can only open files inside the project folder or your library.'
);
const NOT_A_MANUSCRIPT = fail('InvalidInput', 'That isn’t a manuscript in this project.');
const NOT_A_SNAPSHOT = fail('InvalidInput', 'That isn’t one of this document’s snapshots.');

const bytesOf = (text: string) => new TextEncoder().encode(text).length;

export function fakeHistory(disk: HistoryDisk) {
	/** As `history::locate`: a manuscript directly in the project, and its folder. */
	function locate(root: string, document: string) {
		if (!document.startsWith('/')) throw OUTSIDE;
		const at = document.lastIndexOf('/');
		const name = document.slice(at + 1);
		const stem = name.endsWith(EXTENSION)
			? name.slice(0, -EXTENSION.length)
			: name === 'magnum_opus.json'
				? 'magnum_opus.json'
				: null;
		if (!stem || stem.startsWith('.')) throw NOT_A_MANUSCRIPT;
		if (document.slice(0, at) !== root) throw OUTSIDE;
		return { manuscript: document, dir: `${root}/.erti/history/${stem}` };
	}

	/** Newest first, as (time, name). */
	function snapshotsIn(dir: string): [number, string][] {
		const prefix = `${dir}/`;
		return disk
			.list()
			.filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
			.flatMap((path): [number, string][] => {
				const name = path.slice(prefix.length);
				const time = timeOfName(name);
				return time === null ? [] : [[time, name]];
			})
			.sort((a, b) => b[0] - a[0]);
	}

	type Entry = { trigger?: string; words?: number };
	function readIndex(dir: string): Record<string, Entry> {
		try {
			return JSON.parse(disk.text(`${dir}/${INDEX}`) ?? '').snapshots ?? {};
		} catch {
			return {};
		}
	}
	function writeIndex(dir: string, index: Record<string, Entry>) {
		const present = new Set(snapshotsIn(dir).map(([, name]) => name));
		const kept = Object.fromEntries(Object.entries(index).filter(([name]) => present.has(name)));
		disk.write(`${dir}/${INDEX}`, JSON.stringify({ snapshots: kept }, null, 2));
	}

	const TRIGGERS: Trigger[] = ['writing', 'close', 'quit', 'before_restore'];
	function snapshot(dir: string, time: number, name: string, entry?: Entry): Snapshot {
		const trigger = TRIGGERS.find((t) => t === entry?.trigger) ?? null;
		return {
			file: name,
			takenAt: time,
			trigger,
			words: entry?.words ?? null,
			bytes: bytesOf(disk.text(`${dir}/${name}`) ?? '')
		};
	}

	function list(dir: string): History {
		const index = readIndex(dir);
		const snapshots = snapshotsIn(dir).map(([time, name]) =>
			snapshot(dir, time, name, index[name])
		);
		const indexBytes = bytesOf(disk.text(`${dir}/${INDEX}`) ?? '');
		return { snapshots, bytes: snapshots.reduce((sum, s) => sum + s.bytes, indexBytes) };
	}

	function take(
		dir: string,
		manuscript: string,
		trigger: Trigger,
		words: number | null,
		now: number
	): Snapshot | null {
		// The newest not from the future, as `history.rs` reads it.
		const newest = snapshotsIn(dir).find(([time]) => time <= now);
		if (newest && trigger === 'writing' && now - newest[0] < WHILE_WRITING_EVERY) return null;
		const content = disk.text(manuscript);
		if (content === undefined) return null;
		if (newest && disk.text(`${dir}/${newest[1]}`) === content) return null;

		let at = now;
		while (disk.text(`${dir}/${nameFor(at)}`) !== undefined) at += 1;
		const name = nameFor(at);
		disk.write(`${dir}/${name}`, content);
		const entry: Entry = { trigger, ...(words === null ? {} : { words }) };
		writeIndex(dir, { ...readIndex(dir), [name]: entry });
		return snapshot(dir, at, name, entry);
	}

	function read(dir: string, file: string): string {
		if (timeOfName(file) === null) throw NOT_A_SNAPSHOT;
		const text = disk.text(`${dir}/${file}`);
		if (text === undefined) throw fail('NotFound', `${file} isn’t there any more.`);
		return text;
	}

	return {
		locate,
		list,
		take,
		read,
		restore(dir: string, manuscript: string, file: string, words: number | null, now: number) {
			const content = read(dir, file);
			const before = take(dir, manuscript, 'before_restore', words, now);
			disk.write(manuscript, content);
			return before;
		},
		/** As `history::move_to`: renamed, or joined to a history kept under that name. */
		move(from: string, to: string) {
			if (from === to) return;
			const index = readIndex(from);
			const moved: Record<string, Entry> = {};
			for (const [time, name] of snapshotsIn(from)) {
				let at = time;
				while (disk.text(`${to}/${nameFor(at)}`) !== undefined) at += 1;
				disk.write(`${to}/${nameFor(at)}`, disk.text(`${from}/${name}`) ?? '');
				disk.remove(`${from}/${name}`);
				if (index[name]) moved[nameFor(at)] = index[name];
			}
			if (Object.keys(moved).length > 0) writeIndex(to, { ...readIndex(to), ...moved });
			disk.remove(`${from}/${INDEX}`);
		},
		clear(dir: string, olderThanDays: number, now: number): number {
			const cutoff = now - olderThanDays * DAY;
			const old = snapshotsIn(dir).filter(([time]) => time < cutoff);
			for (const [, name] of old) disk.remove(`${dir}/${name}`);
			if (old.length > 0) writeIndex(dir, readIndex(dir));
			return old.length;
		}
	};
}
