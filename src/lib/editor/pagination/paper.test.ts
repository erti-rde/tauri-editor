import { describe, expect, it } from 'vitest';

import {
	DEFAULT_PAGE_SETUP,
	MARGINS,
	PAPERS,
	SPACINGS,
	spacingById,
	fillPlaceholders,
	normalisePageSetup,
	paperById,
	toPageRule,
	toPixelConfig
} from './paper';

/**
 * The screen and the printer have to agree about how big a page is.
 *
 * On-screen pagination measures pixels; `@page` works in inches. Nothing warns
 * you when the two drift — the editor shows five pages, the PDF has six, and
 * the author finds out from a journal. These assertions are the only place that
 * agreement is checked.
 */

describe('a sheet of paper', () => {
	it('is the size it says it is, at 96 pixels to the inch', () => {
		// CSS defines the pixel as 1/96 inch. US Letter is 8.5x11, so anything
		// other than 816x1056 is a page that prints at the wrong size.
		expect(paperById('letter')).toMatchObject({ widthPx: 816, heightPx: 1056 });
		// The pagination library ships 1060x818 for Letter, which is four pixels
		// of drift a page — most of a line by page twenty. Ours is derived.
		expect(paperById('letter').widthPx).not.toBe(818);
		expect(paperById('letter').heightPx).not.toBe(1060);
	});

	it('gets A4 right in millimetres', () => {
		// 210x297mm at 96/25.4 px per mm.
		expect(paperById('a4')).toMatchObject({ widthPx: 794, heightPx: 1123 });
	});

	it('keeps Legal the same width as Letter and only taller', () => {
		expect(paperById('legal').widthPx).toBe(paperById('letter').widthPx);
		expect(paperById('legal').heightPx).toBeGreaterThan(paperById('letter').heightPx);
	});

	it('falls back to a real page rather than undefined', () => {
		// The id arrives from a settings file that can be hand-edited.
		expect(paperById('foolscap').id).toBe('letter');
		expect(paperById('').id).toBe('letter');
	});
});

describe('the pixel config the screen paginates with', () => {
	it('derives every dimension from the chosen paper and margin', () => {
		const config = toPixelConfig({ ...DEFAULT_PAGE_SETUP, paper: 'a4', margin: 'wide' });

		expect(config).toMatchObject({
			pageWidth: 794,
			pageHeight: 1123,
			// 1.5in at 96dpi.
			marginTop: 144,
			marginBottom: 144,
			marginLeft: 144,
			marginRight: 144
		});
	});

	it('adds no second vertical margin inside the page', () => {
		// The page margin is already there. A content margin on top of it is what
		// pushes the last line of each page off the bottom of the printed sheet.
		const config = toPixelConfig(DEFAULT_PAGE_SETUP);

		expect(config.contentMarginTop).toBe(0);
		expect(config.contentMarginBottom).toBe(0);
	});

	it.each(PAPERS.map((p) => p.id))('leaves usable width on %s at every margin', (paper) => {
		for (const margin of MARGINS) {
			const config = toPixelConfig({ ...DEFAULT_PAGE_SETUP, paper, margin: margin.id });
			const textWidth = config.pageWidth - config.marginLeft - config.marginRight;

			// A measure narrower than this is unreadable, and would mean a margin
			// preset that silently ruins the page.
			expect(textWidth).toBeGreaterThan(300);
		}
	});
});

describe('the rule the printer is given', () => {
	it('names the paper the screen is using', () => {
		expect(toPageRule({ ...DEFAULT_PAGE_SETUP, paper: 'a4' })).toContain('size: A4');
	});

	it.each(PAPERS.map((p) => p.id))('asks for the same sheet as the screen, on %s', (paper) => {
		const setup = { ...DEFAULT_PAGE_SETUP, paper };

		expect(toPageRule(setup)).toContain(`size: ${paperById(paper).css}`);
		expect(toPixelConfig(setup).pageWidth).toBe(paperById(paper).widthPx);
	});

	it('contributes no margin while the page box is drawing one', () => {
		// The doubled-margin bug. A paginated page already carries the margin as
		// real layout, so an @page margin on top of it prints two inches where one
		// was asked for — and it only shows up in the PDF, never on screen.
		expect(toPageRule({ ...DEFAULT_PAGE_SETUP, paginate: true, margin: 'normal' })).toBe(
			'@page { size: letter; margin: 0in; }'
		);
	});

	it('supplies the margin itself when nothing else will', () => {
		// Pagination off means one continuous column and no page box, so the
		// margin has to come from here or the text runs to the paper's edge.
		expect(toPageRule({ ...DEFAULT_PAGE_SETUP, paginate: false, margin: 'wide' })).toBe(
			'@page { size: letter; margin: 1.5in; }'
		);
	});

	it.each(MARGINS.map((m) => m.id))('puts %s on the page exactly once', (margin) => {
		// Whoever draws it, the total has to be the margin the author chose.
		const inches = MARGINS.find((m) => m.id === margin)!.inches;

		const paginated = { ...DEFAULT_PAGE_SETUP, margin, paginate: true };
		const fromPage = Number(toPageRule(paginated).match(/margin: ([\d.]+)in/)![1]);
		const fromBox = toPixelConfig(paginated).marginLeft / 96;
		expect(fromPage + fromBox).toBeCloseTo(inches, 5);

		const flowing = { ...DEFAULT_PAGE_SETUP, margin, paginate: false };
		const flowingMargin = Number(toPageRule(flowing).match(/margin: ([\d.]+)in/)![1]);
		expect(flowingMargin).toBeCloseTo(inches, 5);
	});
});

describe('line spacing', () => {
	it('offers double, which is what most journals require', () => {
		expect(spacingById('double').value).toBe(2);
	});

	it('does not set single solid', () => {
		// A manuscript at exactly 1 is unreadable, and "single" in Word has never
		// meant the font size exactly.
		expect(spacingById('single').value).toBeGreaterThan(1);
		expect(spacingById('single').value).toBeLessThan(1.3);
	});

	it('increases with each step', () => {
		const values = SPACINGS.map((s) => s.value);

		expect(values).toEqual([...values].sort((a, b) => a - b));
		expect(new Set(values).size).toBe(values.length);
	});

	it('falls back to something readable rather than undefined', () => {
		expect(spacingById('triple').id).toBe('single');
	});
});

describe('reading a stored page setup', () => {
	it('gives pages to a settings file written before this existed', () => {
		// Absent means "not yet chosen", not "turned off" — a manuscript that
		// silently lost its pages on upgrade would look broken.
		expect(normalisePageSetup({}).paginate).toBe(true);
		expect(normalisePageSetup(null).paginate).toBe(true);
	});

	it('turns pagination off only when asked explicitly', () => {
		expect(normalisePageSetup({ paginate: false }).paginate).toBe(false);
	});

	it('survives nonsense in a hand-edited file', () => {
		const setup = normalisePageSetup({
			paper: 'papyrus' as never,
			margin: 'enormous' as never,
			runningHeads: { footerRight: 42 } as never
		});

		expect(setup.paper).toBe('letter');
		expect(setup.margin).toBe('normal');
		expect(setup.runningHeads.footerRight).toBe('Page {page} of {total}');
	});

	it('leaves the first page alone unless asked', () => {
		// The opposite default to `paginate`: absent means "not asked for", and
		// silently removing someone's page number from page one would surprise.
		expect(normalisePageSetup({}).firstPageBare).toBe(false);
		expect(normalisePageSetup({ firstPageBare: true }).firstPageBare).toBe(true);
		// Not merely truthy — a hand-edited file can hold anything.
		expect(normalisePageSetup({ firstPageBare: 'yes' as never }).firstPageBare).toBe(false);
	});

	it('keeps a running head someone deliberately emptied', () => {
		// '' is a choice — "no page number" — and must not be refilled from the
		// default every time the file is read.
		const setup = normalisePageSetup({ runningHeads: { footerRight: '' } as never });

		expect(setup.runningHeads.footerRight).toBe('');
	});
});

describe('the placeholders in a running head', () => {
	it('fills in the page and the count', () => {
		expect(fillPlaceholders('Page {page} of {total}', 3, 12)).toBe('Page 3 of 12');
	});

	it('fills every occurrence, not just the first', () => {
		expect(fillPlaceholders('{page}/{total} — {page}', 2, 4)).toBe('2/4 — 2');
	});

	it('leaves text with no placeholders alone', () => {
		expect(fillPlaceholders('Confidential', 1, 1)).toBe('Confidential');
	});
});
