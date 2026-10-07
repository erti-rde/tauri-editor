/**
 * The pieces of CSL-JSON every import format builds (ADR 009): dates, names
 * and titles. Pure, and shared, so BibTeX and RIS say a date the same way.
 */

export type CslDate = { 'date-parts': number[][] } | { literal: string };
export type CslName = Record<string, string>;

const MONTHS = [
	'jan',
	'feb',
	'mar',
	'apr',
	'may',
	'jun',
	'jul',
	'aug',
	'sep',
	'oct',
	'nov',
	'dec'
] as const;

/** A month as a number from 1, from "3", "03", "March" or "mar". */
export function monthOf(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const v = value.trim().toLowerCase();
	if (/^\d{1,2}$/.test(v)) {
		const n = Number(v);
		return n >= 1 && n <= 12 ? n : undefined;
	}
	const i = MONTHS.indexOf(v.slice(0, 3) as (typeof MONTHS)[number]);
	return i === -1 ? undefined : i + 1;
}

/** One end of a date: "2020", "2020-03", "2020-03-05". */
function datePart(value: string): number[] | undefined {
	const match = value.trim().match(/^(-?\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
	if (!match) return undefined;
	const parts = [Number(match[1])];
	if (match[2]) {
		const month = Number(match[2]);
		if (month < 1 || month > 12) return undefined;
		parts.push(month);
		if (match[3]) {
			const day = Number(match[3]);
			if (day < 1 || day > 31) return undefined;
			parts.push(day);
		}
	}
	return parts;
}

/**
 * A BibLaTeX or ISO 8601 date, or a range of two ("2019/2020"). Anything else
 * ("in press", "n.d.") is kept as written rather than lost: citeproc prints a
 * literal date as it is.
 */
export function parseDate(value: string | undefined): CslDate | undefined {
	const v = value?.trim();
	if (!v) return undefined;
	const ends = v.split('/');
	if (ends.length === 2) {
		const from = datePart(ends[0]);
		// An open range ("2020/") is the date it starts. The end has a year of
		// its own, so "2020/03" isn't read as a range ending in the year 3.
		const open = ends[1] === '' || ends[1] === '..';
		const to = /^\d{4}/.test(ends[1]) ? datePart(ends[1]) : undefined;
		if (from && (open || to)) return { 'date-parts': to ? [from, to] : [from] };
	}
	const one = datePart(v);
	return one ? { 'date-parts': [one] } : { literal: v };
}

/** A date from separate year, month and day, as BibTeX keeps them. */
export function dateFrom(
	year: string | undefined,
	month?: string,
	day?: string
): CslDate | undefined {
	const y = year?.trim();
	if (!y) return undefined;
	if (!/^-?\d{1,4}$/.test(y)) return { literal: y };
	const parts = [Number(y)];
	const m = monthOf(month);
	if (m) {
		parts.push(m);
		const d = day && /^\d{1,2}$/.test(day.trim()) ? Number(day) : undefined;
		if (d && d >= 1 && d <= 31) parts.push(d);
	}
	return { 'date-parts': [parts] };
}

/** The year a CSL date starts in, if it says one. */
export function yearOf(date: unknown): number | undefined {
	if (typeof date !== 'object' || date === null) return undefined;
	const parts = (date as { 'date-parts'?: unknown })['date-parts'];
	if (Array.isArray(parts) && Array.isArray(parts[0]) && typeof parts[0][0] === 'number') {
		return parts[0][0];
	}
	const literal =
		(date as { literal?: unknown; raw?: unknown }).literal ?? (date as { raw?: unknown }).raw;
	const year = typeof literal === 'string' ? literal.match(/\b(\d{4})\b/) : null;
	return year ? Number(year[1]) : undefined;
}

/** Inline markup citeproc renders in a title; everything else is taken out. */
const KEPT_TAGS = /^<\/?(i|b|sup|sub)>$/i;

/**
 * Text as citeproc may be given it: its own inline markup kept, other tags
 * dropped, space tidied. Composed (NFC), since the parser writes "è" as an "e"
 * and an accent, which then matches nothing typed.
 */
export function richText(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const tidy = value
		.normalize('NFC')
		.replace(/<[^>]*>/g, (tag) => (KEPT_TAGS.test(tag) ? tag.toLowerCase() : ''))
		.replace(/\s+/g, ' ')
		.trim();
	return tidy || undefined;
}

/** Plain text: no markup at all, space tidied, composed. */
export function plainText(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const tidy = value
		.normalize('NFC')
		.replace(/<[^>]*>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return tidy || undefined;
}

/** A title and its subtitle, as one CSL title. */
export function withSubtitle(
	title: string | undefined,
	subtitle: string | undefined
): string | undefined {
	if (!title) return subtitle;
	if (!subtitle) return title;
	// "Title?: Subtitle" reads wrong; the title's own mark stands for the colon.
	return /[?!:.]$/.test(title) ? `${title} ${subtitle}` : `${title}: ${subtitle}`;
}

/**
 * A page range as CSL writes it, with a hyphen: citeproc reformats a range
 * ("321–28") only when it can find the hyphen.
 */
export function pageRange(value: string | undefined): string | undefined {
	return plainText(value)?.replace(/\s*[–—-]+\s*/g, '-');
}

/** A name written "Family, Given" or "Family, Suffix, Given", or one as written. */
export function nameFromText(value: string): CslName | undefined {
	const v = value.trim();
	if (!v) return undefined;
	const parts = v.split(',').map((p) => p.trim());
	if (parts.length === 1) return { literal: v };
	const [family, second, third] = parts;
	if (!family) return { literal: v };
	const name: CslName = { family };
	// RIS writes "Family, Given, Suffix"; BibTeX's "Family, Suffix, Given" is parsed upstream.
	if (second) name.given = second;
	if (third) name.suffix = third;
	return name;
}

/** "Others" in a BibTeX name list stands for "et al.", which the style decides. */
export function isOthers(name: { lastName?: string; name?: string; firstName?: string }): boolean {
	return !name.firstName && (name.lastName ?? name.name ?? '').trim().toLowerCase() === 'others';
}
