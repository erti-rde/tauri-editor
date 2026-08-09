import { load as loadStore, type Store } from '@tauri-apps/plugin-store';

/**
 * The projects this person has open recently.
 *
 * Reopening yesterday's work is the single most common thing anyone does on
 * launch, and until now it meant walking the folder picker there every time.
 *
 * Paths are kept, not copies: a project is a folder on disk and this only
 * remembers where. A folder that has since been moved or deleted is shown as
 * missing rather than quietly dropped, because a researcher who cannot find
 * their project wants to know Erti last saw it at that path.
 */

export interface RecentProject {
	path: string;
	/** Folder name, which is what people call their projects. */
	name: string;
	/** When it was last opened, as an ISO string. */
	openedAt: string;
}

const KEY = 'recentProjects';
const SETTINGS_FILE = 'settings-store.json';

/** Enough to cover what someone is actually working on, without becoming a list. */
export const MAX_RECENT = 8;

let store: Store | undefined;

async function settings(): Promise<Store> {
	store ??= await loadStore(SETTINGS_FILE);
	return store;
}

/** The folder's own name, which is what the user named the project. */
export function projectName(path: string): string {
	const parts = path.split(/[/\\]/).filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

/**
 * Add a project to the front of the list.
 *
 * Pure so the ordering rules can be tested without a filesystem: most recent
 * first, no duplicates, and bounded.
 */
export function withProject(
	existing: readonly RecentProject[],
	path: string,
	openedAt = new Date().toISOString()
): RecentProject[] {
	// Reopening a project moves it to the front rather than adding it twice.
	const others = existing.filter((p) => p.path !== path);

	return [{ path, name: projectName(path), openedAt }, ...others].slice(0, MAX_RECENT);
}

/** Anything unreadable yields an empty list rather than blocking the screen. */
export function normaliseRecents(input: unknown): RecentProject[] {
	if (!Array.isArray(input)) return [];

	// A path appears once. Svelte keys the list by path, so a duplicate from a
	// settings file written by an older build crashes the landing screen rather
	// than merely showing the row twice.
	const seen = new Set<string>();

	return input
		.filter(
			(entry): entry is RecentProject =>
				!!entry && typeof entry.path === 'string' && entry.path.length > 0
		)
		.filter((entry) => {
			if (seen.has(entry.path)) return false;
			seen.add(entry.path);
			return true;
		})
		.map((entry) => ({
			path: entry.path,
			name: typeof entry.name === 'string' && entry.name ? entry.name : projectName(entry.path),
			openedAt: typeof entry.openedAt === 'string' ? entry.openedAt : ''
		}))
		.slice(0, MAX_RECENT);
}

export async function readRecents(): Promise<RecentProject[]> {
	try {
		return normaliseRecents(await (await settings()).get(KEY));
	} catch (error) {
		// A launch screen is not worth failing over.
		console.error('Could not read recent projects:', error);
		return [];
	}
}

export async function rememberProject(path: string): Promise<void> {
	try {
		const s = await settings();
		await s.set(KEY, withProject(normaliseRecents(await s.get(KEY)), path));
		await s.save();
	} catch (error) {
		console.error('Could not record the recent project:', error);
	}
}

export async function forgetProject(path: string): Promise<RecentProject[]> {
	try {
		const s = await settings();
		const next = normaliseRecents(await s.get(KEY)).filter((p) => p.path !== path);
		await s.set(KEY, next);
		await s.save();
		return next;
	} catch (error) {
		console.error('Could not remove the recent project:', error);
		return readRecents();
	}
}

/** "yesterday", rather than a timestamp nobody reads. */
export function describeWhen(iso: string, now = new Date()): string {
	if (!iso) return '';

	const then = new Date(iso);
	if (Number.isNaN(then.getTime())) return '';

	const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);

	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 7) return `${days} days ago`;
	if (days < 30) return plural(Math.floor(days / 7), 'week');
	if (days < 365) return plural(Math.floor(days / 30), 'month');
	return 'over a year ago';
}

/** "1 week ago", not "1 weeks ago". */
function plural(count: number, unit: string): string {
	return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}
