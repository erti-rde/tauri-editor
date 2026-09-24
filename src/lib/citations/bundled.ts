/**
 * The citation styles and locales that ship with Erti, and how the app decides
 * which style and locale to use.
 *
 * The only way to get a style used to be downloading one in Settings. The
 * editor would not open without one, and the download was blocked, so a fresh
 * install could not write at all. Bundling a handful of styles means citing
 * works offline from the first launch, and declining network lookups costs
 * nothing.
 *
 * Like the other modules under `citations/`, this has no Tauri or Svelte imports:
 * reading a resource is passed in, so the decision can be tested directly.
 */

export interface BundledStyle {
	id: string;
	/** The style's upstream title, as the online index lists it. */
	name: string;
	/** What people call it, shown in Settings. */
	label: string;
	/** Path under `resources/csl/`. */
	file: string;
}

export interface BundledManifest {
	default: { style: string; locale: string };
	styles: BundledStyle[];
	/** Locale code → path under `resources/csl/`. */
	locales: Record<string, string>;
}

/** What Settings has stored, any of which can be missing on a fresh install. */
export interface StoredCitationSettings {
	styleXml?: unknown;
	localeXml?: unknown;
	selectedStyle?: unknown;
	selectedLocale?: unknown;
}

export interface CitationSetup {
	styleXml: string;
	localeXml: string;
	/** The style's name, for Settings to show as selected. */
	styleName: string;
	locale: string;
	/** True when the style came from the app rather than from Settings. */
	styleIsBundled: boolean;
}

/** Reads a file under `resources/csl/`. */
export type ReadResource = (path: string) => Promise<string>;

/**
 * Check the manifest's shape, rather than trusting it.
 *
 * A corrupt or hand-edited install must fail with a message that says what is
 * wrong, not with `undefined` deep inside citeproc.
 */
export function parseManifest(value: unknown): BundledManifest {
	const m = value as Partial<BundledManifest> | null;
	const styles = Array.isArray(m?.styles) ? m.styles : null;
	if (
		!m ||
		typeof m.default?.style !== 'string' ||
		typeof m.default?.locale !== 'string' ||
		!styles ||
		styles.some(
			(s) =>
				typeof s?.id !== 'string' ||
				typeof s?.name !== 'string' ||
				typeof s?.label !== 'string' ||
				typeof s?.file !== 'string'
		) ||
		typeof m.locales !== 'object' ||
		m.locales === null
	) {
		throw new Error('The bundled citation styles are damaged. Reinstalling Erti will fix this.');
	}
	if (!styles.some((s) => s.id === m.default!.style)) {
		throw new Error(`The default citation style "${m.default.style}" is not bundled.`);
	}
	if (!(m.default.locale in m.locales!)) {
		throw new Error(`The default citation language "${m.default.locale}" is not bundled.`);
	}
	return m as BundledManifest;
}

export function bundledStyleByName(manifest: BundledManifest, name: unknown) {
	return manifest.styles.find((style) => style.name === name) ?? null;
}

export function isBundledLocale(manifest: BundledManifest, locale: unknown): locale is string {
	return typeof locale === 'string' && locale in manifest.locales;
}

const nonEmpty = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0;

function assertXml(xml: string, what: string): string {
	if (!xml.trim().startsWith('<')) throw new Error(`${what} could not be read.`);
	return xml;
}

/**
 * Decide which style and locale to use.
 *
 * Whatever Settings stored wins. Anything missing falls back to what ships with
 * the app: the stored locale if it's bundled, otherwise the default. Nothing
 * here touches the network.
 *
 * The manifest is loaded only when something is missing, so a damaged install
 * can't break citations that never needed the bundled files.
 */
export async function resolveCitationSetup(
	stored: StoredCitationSettings,
	loadManifest: () => Promise<BundledManifest>,
	readResource: ReadResource
): Promise<CitationSetup> {
	let styleXml: string;
	let styleName: string;
	let styleIsBundled: boolean;
	if (nonEmpty(stored.styleXml)) {
		styleXml = stored.styleXml;
		styleName = nonEmpty(stored.selectedStyle) ? stored.selectedStyle : '';
		// Only informative, so an unreadable manifest just means "not bundled".
		const manifest = await loadManifest().catch(() => null);
		styleIsBundled = manifest !== null && bundledStyleByName(manifest, styleName) !== null;
	} else {
		const manifest = await loadManifest();
		const defaultStyle = manifest.styles.find((s) => s.id === manifest.default.style)!;
		styleXml = assertXml(
			await readResource(defaultStyle.file),
			`The bundled style "${defaultStyle.label}"`
		);
		styleName = defaultStyle.name;
		styleIsBundled = true;
	}

	let localeXml: string;
	let locale: string;
	if (nonEmpty(stored.localeXml)) {
		localeXml = stored.localeXml;
		locale = nonEmpty(stored.selectedLocale)
			? stored.selectedLocale
			: ((await loadManifest().catch(() => null))?.default.locale ?? 'en-GB');
	} else {
		const manifest = await loadManifest();
		locale = isBundledLocale(manifest, stored.selectedLocale)
			? stored.selectedLocale
			: manifest.default.locale;
		localeXml = assertXml(
			await readResource(manifest.locales[locale]),
			`The bundled citation language "${locale}"`
		);
	}

	return { styleXml, localeXml, styleName, locale, styleIsBundled };
}

/** The parts of a CSL item a fallback label needs. */
interface LabelItem {
	author?: Array<{ family?: string; given?: string; literal?: string }>;
	editor?: Array<{ family?: string; literal?: string }>;
	title?: string;
	issued?: { 'date-parts'?: unknown[][] };
}

/**
 * A readable stand-in for a citation when styles can't be applied.
 *
 * Better than nothing, and better than a 64-character content hash: "(Vaswani,
 * 2017; Devlin, 2019)". Once a style loads again, every citation re-renders
 * properly, so this never reaches an export.
 */
export function fallbackLabel(items: readonly LabelItem[]): string {
	const parts = items.map((item) => {
		const person = item.author?.[0] ?? item.editor?.[0];
		const who =
			person?.family ?? person?.literal ?? item.title?.split(/\s+/).slice(0, 3).join(' ') ?? '';
		const year = item.issued?.['date-parts']?.[0]?.[0];
		const when = typeof year === 'number' || typeof year === 'string' ? String(year) : 'n.d.';
		return who ? `${who}, ${when}` : when;
	});
	return parts.length > 0 ? `(${parts.join('; ')})` : '(citation)';
}
