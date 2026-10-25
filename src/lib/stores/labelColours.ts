/**
 * The colours a highlight label can take: the eight defaults' own (M6-8).
 *
 * A label used to take any colour a native picker offered, which meant one
 * the palettes were never checked with: a pale yellow mark vanishes on paper,
 * and a dark one hides the words it marks. These are the eight in
 * `DEFAULT_LABELS` (src-tauri/src/db/queries.rs), in the same order, so every
 * mark is drawn in a colour that's been seen on every palette.
 *
 * Each is named as well as shown, and named as "Name them after their
 * colours" names it (`colour_name`), so the two never disagree.
 */
export interface LabelColour {
	/** HSL channels, as a label stores them: "45 95% 62%". */
	value: string;
	name: string;
	/** The default label that starts in it. */
	labelId: string;
}

export const LABEL_COLOURS: readonly LabelColour[] = [
	{ value: '45 95% 62%', name: 'Yellow', labelId: 'claim' },
	{ value: '145 50% 55%', name: 'Green', labelId: 'evidence' },
	{ value: '210 80% 65%', name: 'Blue', labelId: 'method' },
	{ value: '5 80% 66%', name: 'Red', labelId: 'limitation' },
	{ value: '185 55% 52%', name: 'Teal', labelId: 'definition' },
	{ value: '280 50% 68%', name: 'Purple', labelId: 'counter-point' },
	{ value: '325 70% 68%', name: 'Pink', labelId: 'interesting' },
	{ value: '220 12% 62%', name: 'Grey', labelId: 'my-opinion' }
];

/** The colour a default label starts in, for putting it back. */
export function defaultColourFor(labelId: string): string | undefined {
	return LABEL_COLOURS.find((colour) => colour.labelId === labelId)?.value;
}
