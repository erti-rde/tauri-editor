import type { AugmentedZoteroItemType } from './adapterCslZotero';

/**
 * A source's CSL-JSON as the edit form shows it, and back (M1a-6).
 *
 * The form is laid out by Zotero's schema: a type, that type's fields, and its
 * creator roles. Citations are rendered from CSL-JSON. This is the one place
 * that translates between the two, so the sidebar and anything that creates a
 * source by hand (M1b-5) agree on what a field means.
 *
 * Pure: no Svelte, no Tauri (ADR 001).
 */

/** A CSL name: split into parts, or one literal string (an institution). */
export interface CslName {
	family?: string;
	given?: string;
	literal?: string;
	suffix?: string;
	'dropping-particle'?: string;
	'non-dropping-particle'?: string;
	[key: string]: unknown;
}

/** A CSL date, as citeproc reads it. */
export interface CslDate {
	'date-parts'?: (number | string)[][];
	literal?: string;
	raw?: string;
	circa?: boolean | string | number;
	season?: number | string;
}

export type CslItem = Record<string, unknown> & { type?: string; id?: string };

/** A person or body in one of the type's roles. */
export type FormCreator = CslName & { creatorType: string };

export interface FormValues {
	/** The Zotero item type. */
	itemType: string;
	/** Field values as the inputs hold them: always text. Keyed by Zotero field. */
	fields: Record<string, string>;
	creators: FormCreator[];
}

const pad = (n: number | string) => String(n).padStart(2, '0');

/**
 * A date as one line of text: `2017`, `2017-06`, `2017-06-12`, or a range
 * `2017-06/2018`. Partial dates stay partial: a book has a year and nothing
 * else, and inventing "January 1st" would put a false date in a citation.
 * A date citeproc was given as free text (`literal`, `raw`) stays that text.
 */
export function dateToText(value: unknown): string {
	if (value === undefined || value === null || value === '') return '';
	if (typeof value === 'string' || typeof value === 'number') return String(value);

	const date = value as CslDate;
	const parts = date['date-parts'];
	if (Array.isArray(parts) && parts.length > 0 && Array.isArray(parts[0]) && parts[0].length > 0) {
		return parts
			.filter((part) => Array.isArray(part) && part.length > 0)
			.map(([year, month, day]) =>
				[
					String(year),
					month !== undefined ? pad(month) : undefined,
					day !== undefined ? pad(day) : undefined
				]
					.filter((p) => p !== undefined)
					.join('-')
			)
			.join('/');
	}
	return date.literal ?? date.raw ?? '';
}

const ISO_PART = /^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/;

/**
 * Text back to a CSL date. What reads as `YYYY[-MM[-DD]]`, or a range of two,
 * becomes `date-parts`; anything else ("Spring 2019", "n.d.") is kept as a
 * literal, which citeproc prints as given rather than dropping.
 */
export function textToDate(text: string): CslDate | undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;

	const ends = trimmed.split('/');
	if (ends.length <= 2) {
		const parsed = ends.map((end) => ISO_PART.exec(end.trim()));
		if (parsed.every((m) => m !== null)) {
			const dateParts = parsed.map((m) =>
				[m![1], m![2], m![3]].filter((p) => p !== undefined).map(Number)
			);
			const valid = dateParts.every(
				([, month, day]) =>
					(month === undefined || (month >= 1 && month <= 12)) &&
					(day === undefined || (day >= 1 && day <= 31))
			);
			if (valid) return { 'date-parts': dateParts };
		}
	}
	return { literal: trimmed };
}

/** One CSL value as the text an input holds. */
function valueToText(value: unknown, inputType: string | undefined): string {
	if (inputType === 'date') return dateToText(value);
	if (value === undefined || value === null) return '';
	return String(value);
}

/**
 * Text back to a CSL value. A number field that held a number keeps being a
 * number; everything else is the text as typed, since CSL's "number"
 * variables are routinely "12-14" or "Suppl. 2".
 */
function textToValue(text: string, inputType: string | undefined, previous: unknown): unknown {
	if (inputType === 'date') return textToDate(text);
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	if (typeof previous === 'number' && /^-?\d+$/.test(trimmed)) return Number(trimmed);
	return trimmed;
}

/** The item as the form for `type` shows it. */
export function toForm(item: CslItem, type: AugmentedZoteroItemType): FormValues {
	const fields: Record<string, string> = {};
	for (const field of type.fields) {
		if (!field.cslField) continue;
		fields[field.field] = valueToText(item[field.cslField], field.inputType);
	}

	const creators: FormCreator[] = [];
	for (const role of type.creatorTypes) {
		if (!role.cslVariable) continue;
		const names = item[role.cslVariable];
		if (!Array.isArray(names)) continue;
		for (const name of names as CslName[])
			creators.push({ ...name, creatorType: role.creatorType });
	}

	return { itemType: type.itemType, fields, creators };
}

/**
 * The form's values written back over `original`.
 *
 * Only what the form knows about is touched: an `id`, a `note`, or a variable
 * this type has no field for passes through unchanged, so switching the form
 * to another type and back loses nothing. An emptied field is removed rather
 * than kept as `""`, which citeproc would print as a blank.
 *
 * A value whose text didn't change keeps its original form — a date entered as
 * `{ raw: "2019-ish" }` isn't rewritten just because the sidebar was opened.
 */
export function fromForm(
	form: FormValues,
	type: AugmentedZoteroItemType,
	original: CslItem = {}
): CslItem {
	const item: CslItem = { ...original };
	if (type.cslType) item.type = type.cslType;
	const shown = toForm(original, type);

	for (const field of type.fields) {
		if (!field.cslField) continue;
		const text = form.fields[field.field] ?? '';
		if (text === shown.fields[field.field] && field.cslField in original) continue;

		const value = textToValue(text, field.inputType, original[field.cslField]);
		if (value === undefined) delete item[field.cslField];
		else item[field.cslField] = value;
	}

	for (const role of type.creatorTypes) {
		if (!role.cslVariable) continue;
		const names = form.creators
			.filter((c) => c.creatorType === role.creatorType)
			.map(({ creatorType: _, ...name }) => cleanName(name))
			.filter((name): name is CslName => name !== null);
		if (names.length > 0) item[role.cslVariable] = names;
		else delete item[role.cslVariable];
	}

	return item;
}

/**
 * A name as CSL wants it: a literal alone, or the parts with the empty ones
 * dropped. A name with nothing in it is no name.
 */
function cleanName(name: CslName): CslName | null {
	const literal = name.literal?.trim();
	if (literal) return { literal };

	const out: CslName = {};
	for (const [key, value] of Object.entries(name)) {
		if (key === 'literal') continue;
		if (typeof value === 'string') {
			if (value.trim()) out[key] = value.trim();
		} else if (value !== undefined && value !== null) {
			out[key] = value;
		}
	}
	return out.family || out.given ? out : null;
}
