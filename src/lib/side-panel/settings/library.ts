/**
 * The words Settings › Library uses for the library's file and its backups
 * (M5-10, UX-10). Pure, so the dates can be tested against a fixed clock.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'long',
	year: 'numeric'
});

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

/** "Today, 09:12", "Yesterday, 18:40", "12 October, 18:40", in local time. */
export function whenTaken(takenAt: number, now: number = Date.now()): string {
	const at = time.format(takenAt);
	const days = Math.round((startOfDay(now) - startOfDay(takenAt)) / DAY_MS);
	if (days === 0) return `Today, ${at}`;
	if (days === 1) return `Yesterday, ${at}`;
	const sameYear = new Date(takenAt).getFullYear() === new Date(now).getFullYear();
	return `${(sameYear ? dayMonth : dayMonthYear).format(takenAt)}, ${at}`;
}

/** The second line under a backup in the restore list. */
export function whatItIs(backup: { beforeVersion: number | null; replaced: boolean }): string {
	if (backup.replaced) return 'Your library before a restore';
	return backup.beforeVersion === null ? 'Daily backup' : 'Taken before an upgrade';
}

/** The rule backups are pruned by, as ADR 008 keeps them. */
export function keptLine(keepDays: number, keepWeeks: number): string {
	return `${keepDays} daily and ${keepWeeks} weekly kept`;
}

/** A path under the home folder, written from `~` as people read it. */
export function shortPath(path: string, home: string): string {
	const trimmed = home.replace(/[\\/]+$/, '');
	if (!trimmed || !path.startsWith(trimmed)) return path;
	const rest = path.slice(trimmed.length);
	return rest === '' || rest.startsWith('/') || rest.startsWith('\\') ? `~${rest}` : path;
}
