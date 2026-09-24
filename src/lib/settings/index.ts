import { load } from '@tauri-apps/plugin-store';

import type { Appearance } from '$lib/theme/theme';
import type { PageSetup } from '$lib/editor/pagination/paper';
import type { RecentProject } from '$lib/landing/recentProjects';

/**
 * Every setting Erti keeps, in one place (M1a-11).
 *
 * Settings were read and written as bare strings against `settings-store.json`
 * from eleven files, each with its own guess at the type and the default. A key
 * spelt differently in two places, or a value of the wrong shape left by an
 * older build, failed quietly. Here each setting declares its key, its type, its
 * default and where it lives; reads return that type or the default, and writes
 * are type-checked. ESLint keeps anything else from loading the store.
 *
 * Owners still decide what a value means (`normalise` in appearance, page setup
 * and recent projects); this decides only whether it's a value at all.
 */

export const SETTINGS_FILE = 'settings-store.json';

/** Where a setting lives. The project database will hold per-project ones. */
export type Where = 'global';

interface Definition<T> {
	key: string;
	default: T;
	where: Where;
	/** Whether a stored value is this setting's type. Anything else reads as the default. */
	accepts: (value: unknown) => boolean;
	/**
	 * Keys this setting used to be stored under, newest first. Read once from
	 * the old key, moved to the new one, and the old key removed.
	 */
	renamedFrom?: readonly string[];
}

const string = (value: unknown) => typeof value === 'string';
const boolean = (value: unknown) => typeof value === 'boolean';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const object = (value: unknown) =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const nullable = (accepts: (value: unknown) => boolean) => (value: unknown) =>
	value === null || accepts(value);

function define<T>(definition: Definition<T>): Definition<T> {
	return definition;
}

export const SETTINGS = {
	/** Where the source library is. Unset means `~/Erti/library.db`. */
	libraryPath: define<string | null>({
		key: 'libraryPath',
		default: null,
		where: 'global',
		accepts: nullable(string)
	}),
	/** Consent for lookups: unset means never asked, which only a first launch sees. */
	allowNetworkLookups: define<boolean | null>({
		key: 'allowNetworkLookups',
		default: null,
		where: 'global',
		accepts: nullable(boolean)
	}),
	/** The address for Crossref's polite pool, if the user gave one. */
	crossrefMailto: define<string>({
		key: 'crossrefMailto',
		default: '',
		where: 'global',
		accepts: string
	}),
	recentProjects: define<RecentProject[]>({
		key: 'recentProjects',
		default: [],
		where: 'global',
		accepts: Array.isArray
	}),
	/** The label the last highlight was given, offered first for the next. */
	lastAnnotationLabel: define<string | null>({
		key: 'lastAnnotationLabel',
		default: null,
		where: 'global',
		accepts: nullable(string)
	}),
	/** The citation style as CSL XML, and its name. Unset means the bundled default. */
	cslXml: define<string | null>({
		key: 'cslXml',
		default: null,
		where: 'global',
		accepts: nullable(string)
	}),
	selectedStyle: define<string | null>({
		key: 'selectedStyle',
		default: null,
		where: 'global',
		accepts: nullable(string)
	}),
	/** The citation language as CSL locale XML, and its code. */
	localeXml: define<string | null>({
		key: 'localeXml',
		default: null,
		where: 'global',
		accepts: nullable(string)
	}),
	selectedLocale: define<string | null>({
		key: 'selectedLocale',
		default: null,
		where: 'global',
		accepts: nullable(string)
	}),
	/** The word count being written to; 0 is none. */
	wordCount: define<number>({ key: 'wordCount', default: 0, where: 'global', accepts: number }),
	/** Whether the margin may point out an unused note. On unless turned off. */
	noteNudges: define<boolean>({
		key: 'noteNudges',
		default: true,
		where: 'global',
		accepts: boolean
	}),
	/** Whether a reference list follows the first citation. On unless turned off. */
	autoReferences: define<boolean>({
		key: 'autoReferences',
		default: true,
		where: 'global',
		accepts: boolean
	}),
	appearance: define<Partial<Appearance>>({
		key: 'appearance',
		default: {},
		where: 'global',
		accepts: object
	}),
	pageSetup: define<Partial<PageSetup>>({
		key: 'pageSetup',
		default: {},
		where: 'global',
		accepts: object
	})
} as const;

export type SettingName = keyof typeof SETTINGS;
export type SettingValue<K extends SettingName> =
	(typeof SETTINGS)[K] extends Definition<infer T> ? T : never;

const store = () => load(SETTINGS_FILE);

/**
 * A setting's value, or its default if it's unset or not of its type.
 *
 * A value left under an old name is moved to the current one on the way.
 */
export async function readSetting<K extends SettingName>(name: K): Promise<SettingValue<K>> {
	return readFrom(SETTINGS[name] as Definition<SettingValue<K>>);
}

/** Store a setting and write the file. */
export async function writeSetting<K extends SettingName>(
	name: K,
	value: SettingValue<K>
): Promise<void> {
	const s = await store();
	await s.set(SETTINGS[name].key, value);
	await s.save();
}

/** Forget a setting, so it reads as its default again. */
export async function clearSetting(name: SettingName): Promise<void> {
	const s = await store();
	await s.delete(SETTINGS[name].key);
	await s.save();
}

/** Exported for the migration test; the app goes through `readSetting`. */
export async function readFrom<T>(definition: Definition<T>): Promise<T> {
	const s = await store();
	let value = await s.get(definition.key);

	if (value === undefined && definition.renamedFrom) {
		for (const old of definition.renamedFrom) {
			const previous = await s.get(old);
			if (previous === undefined) continue;
			await s.set(definition.key, previous);
			await s.delete(old);
			await s.save();
			value = previous;
			break;
		}
	}

	return value !== undefined && definition.accepts(value) ? (value as T) : definition.default;
}

export { define };
