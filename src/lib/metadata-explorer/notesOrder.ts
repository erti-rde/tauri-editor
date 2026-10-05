import type { SourceNote } from '$lib/stores/db';

/**
 * A work's notes in the order its Notes tab lists them (M1b-8, UX-3): notes
 * on the work as a whole first, then by page as printed. Front matter's roman
 * numerals come before the arabic pages, as in the book; a label that is
 * neither ("A-12", "Plate 3") comes last. Equal pages keep the order written.
 */
export function notesInPageOrder(notes: readonly SourceNote[]): SourceNote[] {
	return [...notes].sort((a, b) => compare(pageKey(a.page_label), pageKey(b.page_label)));
}

type Key = [rank: number, value: number, text: string];

/** i to lxxxix: roman numerals as front matter is numbered. */
const FRONT_MATTER = /^(?=[ivxl])(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

function pageKey(label: string | null): Key {
	const page = label?.trim() ?? '';
	if (!page) return [0, 0, ''];
	// Only a well-formed numeral of the size front matter runs to: a plate
	// "C", an appendix "D" or a word like "mid" isn't page 100, 500 or 1499.
	if (FRONT_MATTER.test(page)) return [1, roman(page), ''];
	const number = /^\d+/.exec(page);
	if (number) return [2, Number(number[0]), page];
	return [3, 0, page.toLowerCase()];
}

function compare(a: Key, b: Key): number {
	return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2], undefined, { numeric: true });
}

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function roman(numeral: string): number {
	const digits = [...numeral.toLowerCase()].map((c) => ROMAN[c]);
	return digits.reduce((sum, digit, i) => sum + (digit < (digits[i + 1] ?? 0) ? -digit : digit), 0);
}
