import type { AugmentedZoteroItemType, AugmentedZoteroSchema } from './adapterCslZotero';
import { formFields, type CslItem, type FormValues } from './cslForm';

/**
 * The source form's decisions (M1b-5, docs/ux.md UX-2): which kinds come
 * first, which fields a kind can't do without, and which kind an existing
 * source is. Pure (ADR 001); `cslForm.ts` does the CSL translation.
 */

/** What people add by hand most, first; the rest of Zotero's after, A to Z (UX-2). */
export const FIRST_TYPES = ['book', 'bookSection', 'journalArticle', 'webpage', 'report', 'thesis'];

/** The kinds the form offers: the schema's, those with a CSL type to render as, in UX-2's order. */
export function typeChoices(schema: AugmentedZoteroSchema): { value: string; label: string }[] {
	const rank = (value: string) => {
		const i = FIRST_TYPES.indexOf(value);
		return i === -1 ? FIRST_TYPES.length : i;
	};
	return [...schema.typeFields].sort(
		(a, b) => rank(a.value) - rank(b.value) || a.label.localeCompare(b.label)
	);
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
	for (const field of formFields(type)) {
		if (!isRequired(type.itemType, field.field)) continue;
		if (!(form.fields[field.field] ?? '').trim()) {
			out[field.field] = `Enter the ${inSentence(field.label)}.`;
		}
	}
	return out;
}

/** A Title Case label mid-sentence: "Book Title" is "book title", but URL stays URL. */
function inSentence(label: string): string {
	return label
		.split(' ')
		.map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()))
		.join(' ');
}

/**
 * The kind to show a source as: the one a correction saved, then its recorded
 * Zotero type; otherwise, for a source resolved before `zotero_type` was
 * kept, the kind its CSL type maps to (M1b-5 AC-5). Undefined when none says.
 *
 * The correction first, since it's the researcher's choice: the library's
 * recorded kind is what resolving guessed, and a kind changed and saved must
 * open as what it was changed to.
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
		known(typeof csl?.zotero_type === 'string' ? csl.zotero_type : undefined) ??
		known(recorded) ??
		known(typeof csl?.type === 'string' ? schema.cslToZoteroTypeMap.get(csl.type) : undefined)
	);
}

/** A new hand-made source's id: one no file's hash can ever be (ADR 003). */
export function newSourceId(): string {
	return `erti:${crypto.randomUUID()}`;
}
