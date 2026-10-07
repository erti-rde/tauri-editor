import { parse, type Creator, type Entry } from '@retorquere/bibtex-parser';

import type { CslItem } from '$lib/guard';
import {
	dateFrom,
	isOthers,
	pageRange,
	parseDate,
	plainText,
	richText,
	withSubtitle,
	type CslName
} from './csl';
import { lineCounter, type ImportEntry, type Parsed, type Unreadable } from './types';

/**
 * BibTeX and BibLaTeX to CSL-JSON (M1b-9, ADR 009).
 *
 * `@retorquere/bibtex-parser` reads the file: LaTeX to Unicode, `@string`,
 * crossref and name lists. Erti owns the mapping from its fields to CSL, which
 * the fixtures in `fixtures/` pin for each exporter.
 *
 * Only imported by `index.ts`, and only on demand: the parser is the bulk of
 * an import, and nothing at startup needs it (AC-5).
 */

/** BibLaTeX (and BibTeX) entry types, as CSL's. Anything else is a `document`. */
export const TYPES: Record<string, string> = {
	article: 'article-journal',
	book: 'book',
	mvbook: 'book',
	bookinbook: 'chapter',
	inbook: 'chapter',
	incollection: 'chapter',
	suppbook: 'chapter',
	collection: 'book',
	mvcollection: 'book',
	suppcollection: 'chapter',
	reference: 'book',
	mvreference: 'book',
	inreference: 'entry-encyclopedia',
	proceedings: 'book',
	mvproceedings: 'book',
	inproceedings: 'paper-conference',
	conference: 'paper-conference',
	thesis: 'thesis',
	phdthesis: 'thesis',
	mastersthesis: 'thesis',
	report: 'report',
	techreport: 'report',
	manual: 'report',
	booklet: 'pamphlet',
	periodical: 'periodical',
	suppperiodical: 'article-journal',
	online: 'webpage',
	electronic: 'webpage',
	www: 'webpage',
	unpublished: 'manuscript',
	patent: 'patent',
	dataset: 'dataset',
	software: 'software',
	standard: 'standard',
	legislation: 'legislation',
	jurisdiction: 'legal_case',
	letter: 'personal_communication',
	review: 'review',
	map: 'map',
	artwork: 'graphic',
	image: 'graphic',
	audio: 'song',
	music: 'song',
	video: 'motion_picture',
	movie: 'motion_picture',
	performance: 'performance',
	misc: 'document'
};

/** What a thesis is when the entry type says and its `type` field doesn't. */
const GENRES: Record<string, string> = {
	phdthesis: 'PhD thesis',
	mastersthesis: 'Master’s thesis'
};

/** Types whose `number` is the issue they appeared in. */
const ISSUED_IN = new Set([
	'article-journal',
	'article-magazine',
	'article-newspaper',
	'periodical'
]);

/** BibTeX's name parts as CSL's. */
function name(creator: Creator): CslName | undefined {
	const literal = plainText(creator.name);
	if (literal) return { literal };
	const family = plainText(creator.lastName);
	if (!family) return undefined;
	const out: CslName = { family };
	const parts = {
		given: creator.firstName,
		'non-dropping-particle': creator.prefix,
		suffix: creator.suffix
	};
	for (const [part, value] of Object.entries(parts)) {
		const v = plainText(value);
		if (v) out[part] = v;
	}
	return out;
}

function names(creators: Creator[] | undefined): CslName[] | undefined {
	const out = (creators ?? [])
		.filter((c) => !isOthers(c))
		.map(name)
		.filter((n): n is CslName => n !== undefined);
	return out.length > 0 ? out : undefined;
}

/** A list field (publisher, location) as one string. */
const list = (value: string[] | undefined) =>
	value && value.length > 0 ? plainText(value.join('; ')) : undefined;

const looksLikeUrl = (value: string) => /^(https?|ftp):\/\//i.test(value.trim());

/** Accents as LaTeX writes them, as the combining marks Unicode does. */
const ACCENTS: Record<string, string> = {
	'`': '\u0300',
	"'": '\u0301',
	'^': '\u0302',
	'~': '\u0303',
	'=': '\u0304',
	u: '\u0306',
	'.': '\u0307',
	'"': '\u0308',
	H: '\u030B',
	v: '\u030C',
	c: '\u0327',
	k: '\u0328'
};

/**
 * What Mendeley escapes in fields BibTeX reads verbatim: `{\_}` in a link,
 * `{\`{e}}` in a file's name. Only in braces, as Mendeley writes them, so a
 * Windows path's `\u…` is never read as an accent.
 */
export function mendeleyText(value: string): string {
	return value
		.replace(/\{\\([_%&#$~])\}/g, '$1')
		.replace(/\{\\([`'^~=".uvHck])\s*\{?([A-Za-z])\}?\}/g, (_, accent: string, letter: string) =>
			(letter + ACCENTS[accent]).normalize('NFC')
		);
}

/**
 * The PDFs a `file` field names. Better BibTeX and JabRef write
 * `Description:path:type`, `;` between files and `\` before a literal `:` or
 * `;`. Mendeley writes `:path:pdf`, drops the leading `/` of a Mac or Linux
 * path, and spells a backslash `$\backslash$`.
 */
export function filesIn(field: string | undefined): string[] {
	if (!field) return [];
	const decoded = mendeleyText(field.replace(/\$\\backslash\$/g, '\\'));

	// Split on what isn't escaped, then unescape each piece.
	const split = (text: string, on: string) => {
		const out: string[] = [];
		let current = '';
		for (let i = 0; i < text.length; i++) {
			const c = text[i];
			if (c === '\\' && i + 1 < text.length) {
				current += c + text[++i];
			} else if (c === on) {
				out.push(current);
				current = '';
			} else {
				current += c;
			}
		}
		out.push(current);
		return out;
	};
	const unescape = (text: string) => text.replace(/\\([\\:;_])/g, '$1');

	const paths = split(decoded, ';').flatMap((one) => {
		const parts = split(one.trim(), ':');
		let path: string;
		let type = '';
		if (parts.length >= 3) {
			// A Windows path written without escaping its drive's colon spans two.
			path = parts.slice(1, -1).join(':');
			type = parts[parts.length - 1];
		} else if (parts.length === 2) {
			path = /^[a-z]$/i.test(parts[0]) ? parts.join(':') : parts[0];
			type = /^[a-z]$/i.test(parts[0]) ? '' : parts[1];
		} else {
			path = parts[0];
		}
		path = unescape(path.trim());
		if (/^(Users|home|Volumes|private|mnt|media)\//.test(path)) path = `/${path}`;
		const pdf = /\.pdf$/i.test(path) || /pdf/i.test(type);
		return path && pdf ? [path] : [];
	});
	return [...new Set(paths)];
}

/** One entry's fields as a CSL item. */
export function toCsl(entry: Pick<Entry, 'type' | 'key' | 'fields'>): CslItem {
	const f = entry.fields;
	const kind = entry.type.toLowerCase();
	let type = TYPES[kind] ?? 'document';
	const subtype = f.entrysubtype?.toLowerCase();
	if (type === 'article-journal' && (subtype === 'magazine' || subtype === 'newspaper')) {
		type = `article-${subtype}`;
	}
	const item: CslItem = { type };
	const set = (key: string, value: unknown) => {
		if (value !== undefined && value !== '') item[key] = value;
	};

	set('citation-key', entry.key);
	set('title', richText(withSubtitle(f.title, f.subtitle)));
	if (f.titleaddon) set('title', richText(`${item.title ?? ''}. ${f.titleaddon}`));
	set('title-short', richText(f.shorttitle));

	const journal = withSubtitle(f.journaltitle ?? f.journal, f.journalsubtitle);
	const book = withSubtitle(f.booktitle, f.booksubtitle);
	set(
		'container-title',
		richText(journal ?? book ?? (type === 'chapter' ? f.maintitle : undefined))
	);
	set('container-title-short', plainText(f.shortjournal));
	set('collection-title', richText(f.series));

	set('author', names(f.author));
	set('editor', names(f.editor ?? f.editors));
	set('translator', names(f.translator));
	set('container-author', names(f.bookauthor));
	set('director', names(f.director));

	set('issued', f.date ? parseDate(f.date) : dateFrom(f.year, f.month, f.day));
	set('accessed', parseDate(f.urldate));
	set('original-date', parseDate(f.origdate));
	set('event-date', parseDate(f.eventdate));
	set('event-title', plainText(f.eventtitle));
	set('event-place', plainText(f.venue));

	set('volume', plainText(f.volume));
	set('number-of-volumes', plainText(f.volumes));
	set('edition', plainText(f.edition));
	set('version', plainText(f.version));
	set('page', pageRange(f.pages));
	set('number-of-pages', plainText(f.pagetotal));
	set('chapter-number', plainText(f.chapter));
	set('issue', plainText(f.issue));
	const number = plainText(f.number);
	if (number) {
		if (ISSUED_IN.has(type)) set('issue', item.issue ?? number);
		else if (f.series) set('collection-number', number);
		else set('number', number);
	}
	// An article with only an article number (eid) is found by it.
	if (!item.number && f.eid) set('number', plainText(f.eid));

	// A thesis or report is published by the place it was written.
	const publisher =
		list(f.publisher) ?? list(f.institution) ?? list(f.organization) ?? plainText(f.school);
	set('publisher', publisher);
	set('publisher-place', list(f.location) ?? plainText(f.address));
	set('genre', plainText(f.type) ?? GENRES[kind]);

	set('DOI', plainText(f.doi)?.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, ''));
	set('URL', plainText(f.url && mendeleyText(f.url)));
	if (f.howpublished) {
		// Older entries put a web page's address here, or how it was published.
		const how = plainText(f.howpublished.replace(/^\\url\{(.*)\}$/, '$1'));
		if (how && looksLikeUrl(how)) set('URL', item.URL ?? how);
		else set('publisher', item.publisher ?? how);
	}
	set('ISBN', plainText(f.isbn));
	set('ISSN', plainText(f.issn));
	set('PMID', plainText(f.pmid));
	set('PMCID', plainText(f.pmcid));
	set('language', languageCode(plainText(f.langid ?? f.language)));
	set('keyword', plainText(f.keywords?.join(', ')));
	set('abstract', plainText(f.abstract));
	set('note', plainText([f.note, f.addendum].filter(Boolean).join('. ')));
	set('annote', plainText(f.annotation ?? f.annote));

	return item;
}

/**
 * BibLaTeX's language names (babel's) as the codes CSL expects: citeproc
 * reads `language` to decide, among other things, whether a title is
 * English and may be title-cased. A name it doesn't list is kept as written.
 */
const LANGUAGES: Record<string, string> = {
	english: 'en',
	american: 'en-US',
	usenglish: 'en-US',
	british: 'en-GB',
	ukenglish: 'en-GB',
	canadian: 'en-CA',
	australian: 'en-AU',
	newzealand: 'en-NZ',
	german: 'de',
	ngerman: 'de',
	austrian: 'de-AT',
	naustrian: 'de-AT',
	swissgerman: 'de-CH',
	french: 'fr',
	spanish: 'es',
	catalan: 'ca',
	italian: 'it',
	portuguese: 'pt',
	brazil: 'pt-BR',
	brazilian: 'pt-BR',
	dutch: 'nl',
	danish: 'da',
	swedish: 'sv',
	norsk: 'nb',
	nynorsk: 'nn',
	finnish: 'fi',
	polish: 'pl',
	czech: 'cs',
	russian: 'ru',
	ukrainian: 'uk',
	greek: 'el',
	turkish: 'tr',
	hebrew: 'he',
	arabic: 'ar',
	japanese: 'ja',
	chinese: 'zh',
	korean: 'ko',
	latin: 'la',
	georgian: 'ka'
};

function languageCode(value: string | undefined): string | undefined {
	return value ? (LANGUAGES[value.toLowerCase()] ?? value) : undefined;
}

/** A parser's complaint, said for a person. */
function reasonFor(error: string): string {
	if (/unterminated|unexpected end|eof/i.test(error)) return 'A brace or quote is never closed.';
	if (/duplicate/i.test(error)) return 'It repeats a field.';
	return 'Erti couldn’t read this entry.';
}

const ENTRY_START = /^@\s*(\w+)\s*[{(]\s*([^,\s]*)/;

export function parseBibtex(text: string): Parsed {
	const library = parse(text, {
		// AC-2: titles as written. The default sentence-cases English titles
		// ("Übermensch & Co." → "übermensch & co."), which BibTeX expects and
		// CSL doesn't: the style decides the case.
		english: false,
		sentenceCase: false,
		// A command the parser doesn't know keeps its text, not the whole entry.
		unsupported: 'ignore',
		applyCrossRef: true
	});

	const line = lineCounter(text);
	let cursor = 0;
	const at = (input: string) => {
		const offset = input ? text.indexOf(input, cursor) : -1;
		if (offset === -1) return null;
		cursor = offset;
		return line(offset);
	};

	const entries: ImportEntry[] = [];
	const unreadable: Unreadable[] = [];
	const failed = new Map<string, Unreadable>();
	for (const error of library.errors) {
		const start = error.input?.trimStart() ?? '';
		const match = start.match(ENTRY_START);
		const where = { key: match?.[2] || null, line: null, reason: reasonFor(error.error) };
		if (match) failed.set(start, where);
		else unreadable.push(where);
	}

	for (const entry of library.entries) {
		// An entry the parser gave up on is listed with nothing in it; its
		// error says where it was.
		if (!entry.input) continue;
		const key = entry.key || `entry ${entries.length + 1}`;
		entries.push({
			key,
			line: at(entry.input),
			item: toCsl(entry),
			files: filesIn(entry.fields.file)
		});
	}

	// Found in the text in order, after the entries that parsed.
	cursor = 0;
	for (const [input, where] of failed) unreadable.push({ ...where, line: at(input) });
	return { entries, unreadable };
}
