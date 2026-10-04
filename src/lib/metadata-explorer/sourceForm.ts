import type { AugmentedZoteroItemType, AugmentedZoteroSchema } from './adapterCslZotero';
import type { CslItem, FormValues } from './cslForm';

/**
 * The source form's decisions (M1b-5, docs/ux.md UX-2): which kinds come
 * first, which fields a kind can't do without, and which kind an existing
 * source is. Pure (ADR 001); `cslForm.ts` does the CSL translation.
 */

/** What people add by hand most, first; the rest of Zotero's after, A to Z (UX-2). */
export const FIRST_TYPES = ['book', 'bookSection', 'journalArticle', 'webpage', 'report', 'thesis'];

/** The kinds the form offers: those with a CSL type to render as. */
export function typeChoices(schema: AugmentedZoteroSchema): { value: string; label: string }[] {
	const offered = schema.itemTypes.filter((t) => t.cslType);
	const rank = (t: AugmentedZoteroItemType) => {
		const i = FIRST_TYPES.indexOf(t.itemType);
		return i === -1 ? FIRST_TYPES.length : i;
	};
	return [...offered]
		.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
		.map((t) => ({ value: t.itemType, label: t.label }));
}

/**
 * Beyond the title, which every kind needs: the field a citation of that kind
 * reads as where it's from. A chapter without its book, or a web page without
 * its address, can't be found from the citation.
 */
const REQUIRED: Record<string, string[]> = {
	bookSection: ['bookTitle'],
	journalArticle: ['publicationTitle'],
	webpage: ['url'],
	report: ['institution'],
	thesis: ['university']
};

export function isRequired(itemType: string, field: string): boolean {
	return field === 'title' || (REQUIRED[itemType] ?? []).includes(field);
}

/** The required fields left empty, by Zotero field, with what to say about each. */
export function missing(form: FormValues, type: AugmentedZoteroItemType): Record<string, string> {
	const out: Record<string, string> = {};
	for (const field of type.fields) {
		if (!field.cslField || !isRequired(type.itemType, field.field)) continue;
		if (!(form.fields[field.field] ?? '').trim()) {
			out[field.field] = `Enter the ${field.label.toLowerCase()}.`;
		}
	}
	return out;
}

/**
 * The kind to show a source as. Its recorded Zotero type when it has one;
 * otherwise, for a source resolved before `zotero_type` was kept, the kind its
 * CSL type maps to (M1b-5 AC-5). Undefined when neither says.
 */
export function itemTypeOf(
	recorded: string | null | undefined,
	csl: CslItem | null,
	schema: AugmentedZoteroSchema
): string | undefined {
	const known = (itemType: string | null | undefined) =>
		itemType && schema.itemTypes.some((t) => t.itemType === itemType && t.cslType)
			? itemType
			: undefined;
	return (
		known(recorded) ??
		known(typeof csl?.zotero_type === 'string' ? csl.zotero_type : undefined) ??
		known(typeof csl?.type === 'string' ? schema.cslToZoteroTypeMap.get(csl.type) : undefined)
	);
}

/** A new hand-made source's id: one no file's hash can ever be (ADR 003). */
export function newSourceId(): string {
	return `erti:${crypto.randomUUID()}`;
}
