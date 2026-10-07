import type { CslItem } from '$lib/guard';
import { dateFrom, nameFromText, pageRange, plainText, richText, type CslName } from './csl';
import type { ImportEntry, Parsed, Unreadable } from './types';

/**
 * RIS to CSL-JSON (M1b-9, ADR 009): written by hand, since RIS is a line per
 * field (`TY  - JOUR`) and the mapping to CSL is the whole job.
 */

/** RIS reference types, as CSL's. Anything else is a `document`. */
export const TYPES: Record<string, string> = {
	JOUR: 'article-journal',
	JFULL: 'article-journal',
	ABST: 'article-journal',
	INPR: 'article-journal',
	EJOUR: 'article-journal',
	MGZN: 'article-magazine',
	NEWS: 'article-newspaper',
	BOOK: 'book',
	EBOOK: 'book',
	EDBOOK: 'book',
	SER: 'book',
	CHAP: 'chapter',
	ECHAP: 'chapter',
	CONF: 'paper-conference',
	CPAPER: 'paper-conference',
	THES: 'thesis',
	RPRT: 'report',
	GOVDOC: 'report',
	ELEC: 'webpage',
	ICOMM: 'webpage',
	BLOG: 'post-weblog',
	UNPB: 'manuscript',
	MANSCPT: 'manuscript',
	PAMP: 'pamphlet',
	PAT: 'patent',
	DATA: 'dataset',
	AGGR: 'dataset',
	DBASE: 'dataset',
	COMP: 'software',
	STAND: 'standard',
	ENCYC: 'entry-encyclopedia',
	DICT: 'entry-dictionary',
	MAP: 'map',
	ART: 'graphic',
	VIDEO: 'motion_picture',
	MPCT: 'motion_picture',
	SOUND: 'song',
	MUSIC: 'musical_score',
	BILL: 'bill',
	CASE: 'legal_case',
	STAT: 'legislation',
	HEAR: 'hearing',
	PCOMM: 'personal_communication',
	GEN: 'document'
};

/** Types whose secondary title (`T2`) is the journal, book or proceedings they're in. */
const IN_A_CONTAINER = new Set([
	'article-journal',
	'article-magazine',
	'article-newspaper',
	'chapter',
	'paper-conference',
	'entry-encyclopedia',
	'entry-dictionary',
	'post-weblog',
	'webpage'
]);

/** Types whose `SN` is an ISBN; for the rest it's an ISSN. */
const BOOKISH = new Set(['book', 'chapter', 'paper-conference', 'report', 'thesis', 'pamphlet']);

const LINE = /^([A-Z][A-Z0-9])  ?-(?: (.*))?$/;

/** A RIS date: `YYYY/MM/DD/other`, any part but the year left empty. */
function risDate(value: string | undefined) {
	if (!value) return undefined;
	const [year, month, day] = value.split('/');
	if (!/^\d{4}$/.test(year?.trim() ?? ''))
		return plainText(value) ? { literal: value.trim() } : undefined;
	return dateFrom(year, month, day);
}

/** A path as a reference manager writes a link to its file. */
function fileFrom(value: string): string | undefined {
	const v = value.trim();
	if (/^internal-pdf:/i.test(v)) return undefined; // EndNote's own store, not a path.
	if (/^file:/i.test(v)) {
		try {
			const url = new URL(v);
			const path = decodeURIComponent(url.pathname);
			// file:///C:/… is a Windows path.
			return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path;
		} catch {
			return undefined;
		}
	}
	return /^(\/|[a-z]:[\\/])/i.test(v) ? v : undefined;
}

function toCsl(tags: Map<string, string[]>): { item: CslItem; files: string[] } {
	const one = (...names: string[]) => {
		for (const n of names) {
			const v = tags.get(n)?.find((x) => x.trim());
			if (v) return v.trim();
		}
		return undefined;
	};
	const all = (...names: string[]) => names.flatMap((n) => tags.get(n) ?? []);
	const people = (...names: string[]) => {
		const out = all(...names)
			.map(nameFromText)
			.filter((n): n is CslName => n !== undefined);
		return out.length > 0 ? out : undefined;
	};

	const type = TYPES[one('TY')?.toUpperCase() ?? ''] ?? 'document';
	const item: CslItem = { type };
	const set = (k: string, value: unknown) => {
		if (value !== undefined && value !== '') item[k] = value;
	};

	set('title', richText(one('TI', 'T1', 'CT')));
	set('title-short', richText(one('ST')));
	// The journal is said four ways; the full name first.
	const container = IN_A_CONTAINER.has(type)
		? one('T2', 'JF', 'JO', 'BT', 'JA', 'J1', 'J2')
		: undefined;
	set('container-title', richText(container));
	set('container-title-short', plainText(one('J2', 'JA')));
	set(
		'collection-title',
		richText(one('T3') ?? (IN_A_CONTAINER.has(type) ? undefined : one('T2')))
	);
	// A book's own title may be in BT where TI is missing.
	if (!item.title && !IN_A_CONTAINER.has(type)) set('title', richText(one('BT')));

	set('author', people('AU', 'A1'));
	set('editor', people('A2', 'ED'));
	set('collection-editor', people('A3'));
	set('translator', people('A4'));

	// DA is the whole date where PY is only the year; either may be missing,
	// or say something other than a date.
	const dates = all('DA', 'PY', 'Y1')
		.map((d) => d.trim())
		.filter(Boolean);
	set('issued', risDate(dates.find((d) => /^\d{4}/.test(d)) ?? dates[0]));
	set('accessed', risDate(one('Y2')));
	set('volume', plainText(one('VL')));
	set('issue', plainText(one('IS')));
	set('number-of-volumes', plainText(one('NV')));
	set('edition', plainText(one('ET')));
	const start = one('SP');
	const end = one('EP');
	set('page', pageRange(start && end && !start.includes('-') ? `${start}-${end}` : start));
	set('publisher', plainText(one('PB')));
	set('publisher-place', plainText(one('CY', 'PP')));
	set('genre', plainText(one('M3')));
	set('number', plainText(one('M1')));
	set('section', plainText(one('SE')));
	set('call-number', plainText(one('CN')));
	set('archive', plainText(one('DB')));

	const doi = one('DO');
	set('DOI', plainText(doi?.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, '')));
	set('URL', plainText(all('UR').find((u) => /^(https?|ftp):\/\//i.test(u.trim()))));
	const sn = plainText(one('SN'));
	set(BOOKISH.has(type) ? 'ISBN' : 'ISSN', sn);
	set('language', plainText(one('LA')));
	set('keyword', plainText(all('KW').join(', ')));
	set('abstract', plainText(one('AB', 'N2')));
	set('note', plainText(all('N1').join('. ')));

	const files = all('L1', 'L4', 'UR')
		.map(fileFrom)
		.filter((p): p is string => p !== undefined && /\.pdf$/i.test(p));
	return { item, files: [...new Set(files)] };
}

export function parseRis(text: string): Parsed {
	const entries: ImportEntry[] = [];
	const unreadable: Unreadable[] = [];
	const unended = (tags: Map<string, string[]>, line: number) =>
		unreadable.push({
			key: tags.get('ID')?.[0]?.trim() || null,
			line,
			reason: 'It has no end (ER).'
		});

	let tags: Map<string, string[]> | null = null;
	let start = 0;
	let last: string | null = null;
	const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(LINE);
		if (!match) {
			// A field's text runs on over lines that don't start with a tag.
			const more = lines[i].trim();
			if (tags && last && more) {
				const values = tags.get(last)!;
				values[values.length - 1] += ` ${more}`;
			}
			continue;
		}
		const [, tag, value = ''] = match;
		if (tag === 'TY') {
			if (tags) unended(tags, start);
			tags = new Map([['TY', [value]]]);
			start = i + 1;
			last = 'TY';
		} else if (!tags) {
			if (tag !== 'ER') {
				unreadable.push({
					key: null,
					line: i + 1,
					reason: 'A field outside any entry (no TY before it).'
				});
			}
		} else if (tag === 'ER') {
			const key = tags.get('ID')?.[0]?.trim() || `entry ${entries.length + unreadable.length + 1}`;
			entries.push({ key, line: start, ...toCsl(tags) });
			tags = null;
			last = null;
		} else {
			tags.set(tag, [...(tags.get(tag) ?? []), value]);
			last = tag;
		}
	}
	if (tags) unended(tags, start);
	return { entries, unreadable };
}
