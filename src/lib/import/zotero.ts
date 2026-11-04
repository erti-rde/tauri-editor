import { guardCslItem, LimitError, ShapeError } from '$lib/guard';
import type { ZoteroItem, ZoteroPdf } from '$lib/ipc';
import type { OriginalZoteroSchema } from '$lib/metadata-explorer/adapterCslZotero';
import type { ImportEntry, Unreadable } from './types';

/**
 * Zotero's own map to CSL, from the schema Erti ships (`resources/csl/schema.json`):
 * which CSL type each Zotero type is, which Zotero fields fill each CSL
 * variable, and which CSL variable each kind of creator is.
 */
export type CslMaps = OriginalZoteroSchema['csl'];

/** A paper read from Zotero, ready for the import (M1b-11, ADR 012). */
export interface ZoteroEntry extends ImportEntry {
	library: string;
	/** Zotero's key for the paper: how a sync knows it again. */
	zoteroKey: string;
	pdfs: ZoteroPdf[];
}

/**
 * A date as Zotero stores it: the part it sorts by, then what was typed.
 * "2019-03-00 March 2019" is March 2019; "0000-00-00 Spring" has no year Zotero
 * could find, so it's kept as typed. An access date is "2020-01-02 10:11:12",
 * and its first part is the date.
 */
export function zoteroDate(stored: string): Record<string, unknown> | undefined {
	const value = stored.trim();
	if (!value) return undefined;
	const [sortable, ...rest] = value.split(' ');
	const typed = rest.join(' ').trim();
	const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sortable);
	if (!parts) return { literal: value };
	const [year, month, day] = parts.slice(1).map(Number);
	if (year === 0) return typed ? { literal: typed } : undefined;
	const date = [year];
	if (month > 0) {
		date.push(month);
		if (day > 0) date.push(day);
	}
	return { 'date-parts': [date] };
}

/** The CSL type for a Zotero one. A PDF on its own, or a type CSL lacks, is a document. */
function cslType(itemType: string, maps: CslMaps): string {
	for (const [csl, zotero] of Object.entries(maps.types)) {
		if (zotero.includes(itemType)) return csl;
	}
	return 'document';
}

/**
 * One Zotero paper as CSL, the way Zotero's own CSL export maps it: each
 * variable from the first of its fields the paper has, a type-specific field
 * standing in for the base it's a kind of ("bookTitle" for
 * "publicationTitle"), creators by their role.
 */
export function zoteroToCsl(item: ZoteroItem, maps: CslMaps): Record<string, unknown> {
	const value = new Map<string, string>();
	for (const field of item.fields) {
		if (!field.value.trim()) continue;
		value.set(field.name, field.value);
		if (field.base && !value.has(field.base)) value.set(field.base, field.value);
	}

	const csl: Record<string, unknown> = { type: cslType(item.item_type, maps) };
	for (const [variable, fields] of Object.entries(maps.fields.text)) {
		const found = fields.find((f) => value.has(f));
		if (found) csl[variable] = value.get(found);
	}
	for (const [variable, field] of Object.entries(maps.fields.date)) {
		const stored = value.get(field);
		const date = stored ? zoteroDate(stored) : undefined;
		if (date) csl[variable] = date;
	}

	for (const creator of item.creators) {
		const variable = maps.names[creator.creator_type];
		if (!variable) continue;
		const name = creator.single
			? { literal: `${creator.first_name}${creator.last_name}`.trim() }
			: { family: creator.last_name, given: creator.first_name };
		const names = (csl[variable] as Record<string, string>[] | undefined) ?? [];
		names.push(Object.fromEntries(Object.entries(name).filter(([, v]) => v)));
		csl[variable] = names;
	}
	return csl;
}

/**
 * Zotero's papers as import entries, each through the shape guard (M1b-10)
 * as any import is. One the guard refuses is said, and the rest go on.
 */
export function readZoteroItems(
	items: ZoteroItem[],
	maps: CslMaps
): { entries: ZoteroEntry[]; unreadable: Unreadable[] } {
	const entries: ZoteroEntry[] = [];
	const unreadable: Unreadable[] = [];
	for (const item of items) {
		try {
			entries.push({
				key: item.key,
				line: null,
				item: guardCslItem(zoteroToCsl(item, maps)),
				files: [],
				library: item.library,
				zoteroKey: item.key,
				pdfs: item.pdfs
			});
		} catch (error) {
			if (error instanceof LimitError) {
				unreadable.push({ key: item.key, line: null, reason: error.message });
			} else if (error instanceof ShapeError) {
				unreadable.push({ key: item.key, line: null, reason: 'It isn’t a source.' });
			} else {
				throw error;
			}
		}
	}
	return { entries, unreadable };
}
