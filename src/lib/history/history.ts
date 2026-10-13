import type { Snapshot, Trigger } from '$lib/ipc/bindings';

/**
 * What the History view says about snapshots (UX-9, M5-1 AC-4).
 *
 * Grouped by the writer's own day, each with its time, what took it and how
 * many words it gained or lost on the one before. Pure: the view passes `now`.
 */

/** Snapshots older than this can be cleared in one go (UX-9's footer). */
export const CLEAR_AFTER_DAYS = 90;

/** What took a snapshot, as the list says it. */
export const TRIGGER_WORDS: Record<Trigger, string> = {
	writing: 'while writing',
	close: 'on close',
	quit: 'on quit',
	before_restore: 'before restore'
};

export const RESTORED = 'Restored. Your previous version is saved as a snapshot.';

const plural = (n: number, one: string, many: string) =>
	`${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** "+312 words", "−1,204 words", "no change in words". Null when either count is unknown. */
export function wordDelta(words: number | null, before: number | null): string | null {
	if (words === null || before === null) return null;
	const delta = words - before;
	if (delta === 0) return 'no change in words';
	// A real minus sign, as the mockup sets it: a hyphen reads as a dash.
	const sign = delta > 0 ? '+' : '−';
	return `${sign}${plural(Math.abs(delta), 'word', 'words')}`;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** "Today", "Yesterday", "Monday 12 October", or with the year if it isn't this one. */
export function dayLabel(takenAt: number, now: Date): string {
	const day = startOfDay(new Date(takenAt * 1000));
	const today = startOfDay(now);
	const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
	if (days === 0) return 'Today';
	if (days === 1) return 'Yesterday';
	// Put together by hand: Intl adds a comma before the year in some builds
	// and not others, and "Monday 12 October" is how the mockup reads.
	const part = (options: Intl.DateTimeFormatOptions) => day.toLocaleDateString('en-GB', options);
	const words = [part({ weekday: 'long' }), part({ day: 'numeric' }), part({ month: 'long' })];
	if (day.getFullYear() !== today.getFullYear()) words.push(String(day.getFullYear()));
	return words.join(' ');
}

/** "14:20", in the writer's own time. */
export const timeLabel = (takenAt: number) =>
	new Date(takenAt * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export interface Row {
	snapshot: Snapshot;
	/** Words gained or lost on the snapshot before it, when both are known. */
	delta: string | null;
}

export interface Day {
	label: string;
	rows: Row[];
}

/** The snapshots (newest first, as listed) by day, each with its word delta. */
export function byDay(snapshots: Snapshot[], now: Date): Day[] {
	const days: Day[] = [];
	snapshots.forEach((snapshot, i) => {
		const before = snapshots[i + 1];
		const row = { snapshot, delta: before ? wordDelta(snapshot.words, before.words) : null };
		const label = dayLabel(snapshot.takenAt, now);
		const last = days.at(-1);
		if (last?.label === label) last.rows.push(row);
		else days.push({ label, rows: [row] });
	});
	return days;
}

/** One row's words: "14:20 · while writing · +312 words". */
export function rowText({ snapshot, delta }: Row): string {
	return [
		timeLabel(snapshot.takenAt),
		snapshot.trigger ? TRIGGER_WORDS[snapshot.trigger] : null,
		delta
	]
		.filter(Boolean)
		.join(' · ');
}

/** "4.2 MB", "380 KB", "12 bytes". */
export function sizeLabel(bytes: number): string {
	if (bytes < 1000) return plural(bytes, 'byte', 'bytes');
	if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** How many can be cleared: those older than `CLEAR_AFTER_DAYS`. */
export function clearable(snapshots: Snapshot[], now: Date): number {
	const cutoff = now.getTime() / 1000 - CLEAR_AFTER_DAYS * 86_400;
	return snapshots.filter((s) => s.takenAt < cutoff).length;
}

/** The preview's line: "Today, 11:05 · 8,412 words · read-only". */
export function previewLine(snapshot: Snapshot, now: Date): string {
	return [
		`${dayLabel(snapshot.takenAt, now)}, ${timeLabel(snapshot.takenAt)}`,
		snapshot.words === null ? null : plural(snapshot.words, 'word', 'words'),
		'read-only'
	]
		.filter(Boolean)
		.join(' · ');
}
