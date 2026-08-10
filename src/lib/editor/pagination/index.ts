import type { Editor } from '@tiptap/core';
import { PaginationPlus } from 'tiptap-pagination-plus';

import { DEFAULT_PAGE_SETUP, toPixelConfig, type PageSetup } from './paper';
import { substituteTotal } from './pageCount';

/**
 * Pages, from `tiptap-pagination-plus` (MIT).
 *
 * Tiptap's own Pages extension is what the design was taken from, but it is a
 * paid Pro package behind an authenticated private registry: a contributor
 * without a subscription could not build Erti, and neither could CI. That is
 * disqualifying for a project that is AGPL and promises to stay free, so this
 * is the MIT equivalent — no transitive dependencies, TipTap 3, and the same
 * capabilities: automatic breaks, running heads, `{page}` and `{total}`.
 *
 * This module is the only place that imports it. Everything else in the app
 * talks to `paper.ts`, so replacing the implementation later — or writing our
 * own once the hard cases are understood — is a change to one file.
 */

export {
	DEFAULT_PAGE_SETUP,
	MARGINS,
	PAPERS,
	marginById,
	normalisePageSetup,
	paperById,
	SPACINGS,
	spacingById,
	type MarginId,
	type Margins,
	type PageSetup,
	type Paper,
	type PaperId,
	type RunningHeads,
	type Spacing,
	type SpacingId
} from './paper';

export { pageSetupStore } from './pageSetupStore';
export { observePageCount, pageCount } from './pageCount';

/**
 * The extension, configured for the setup the editor starts with.
 *
 * The gap between pages is chrome rather than paper, so it takes its colour
 * from the app surface and its rule from the line token — a hard-coded white
 * gap is invisible in a light theme and glaring in a dark one.
 */
export function pagination(setup: PageSetup = DEFAULT_PAGE_SETUP) {
	return PaginationPlus.extend({
		/**
		 * Seed storage from the configuration, which upstream does not.
		 *
		 * `addStorage()` there returns the *default* options rather than the
		 * configured ones. `onCreate` happens to re-read the dimensions from
		 * options, so paper size and running heads survive; `enabled` does not,
		 * because it is only ever read from storage. The symptom was an author who
		 * had turned page breaks off getting them back on every launch.
		 *
		 * Seeding storage from the options fixes the one that is broken and closes
		 * the gap the others were falling through by luck.
		 */
		addStorage() {
			return { ...this.parent?.(), ...this.options };
		}
	}).configure({
		...toPixelConfig(setup),
		enabled: setup.paginate,
		pageGap: 24,
		pageGapBorderSize: 1,
		pageGapBorderColor: 'hsl(var(--line))',
		pageBreakBackground: 'hsl(var(--surface))',
		headerLeft: substituteTotal(setup.runningHeads.headerLeft),
		headerRight: substituteTotal(setup.runningHeads.headerRight),
		footerLeft: substituteTotal(setup.runningHeads.footerLeft),
		footerRight: substituteTotal(setup.runningHeads.footerRight),
		...bareFirstPage(setup)
	});
}

/**
 * Clear the running heads on page one, when asked.
 *
 * A title page carries no page number in any style guide. The library takes
 * per-page overrides keyed by page number, so this is an empty header and
 * footer for page 1 rather than anything structural.
 */
function bareFirstPage(setup: PageSetup) {
	if (!setup.firstPageBare) return {};

	const empty = { headerLeft: '', headerRight: '' };
	return {
		customHeader: { 1: empty },
		customFooter: { 1: { footerLeft: '', footerRight: '' } }
	};
}

/**
 * Apply a changed setup to a live editor.
 *
 * One chain rather than several, so the document is re-paginated once instead
 * of once per property — each re-pagination remeasures every node, which is
 * visible as a stutter on a long manuscript.
 */
export function applyPageSetup(editor: Editor, setup: PageSetup) {
	const pixels = toPixelConfig(setup);

	editor
		.chain()
		.updatePageWidth(pixels.pageWidth)
		.updatePageHeight(pixels.pageHeight)
		.updateMargins({
			top: pixels.marginTop,
			bottom: pixels.marginBottom,
			left: pixels.marginLeft,
			right: pixels.marginRight
		})
		.updateHeaderContent(
			substituteTotal(setup.runningHeads.headerLeft),
			substituteTotal(setup.runningHeads.headerRight)
		)
		.updateFooterContent(
			substituteTotal(setup.runningHeads.footerLeft),
			substituteTotal(setup.runningHeads.footerRight)
		)
		.run();

	// Page one is set separately, because the per-page override is a distinct
	// argument to the same commands rather than part of the general content.
	if (setup.firstPageBare) {
		editor.chain().updateHeaderContent('', '', 1).updateFooterContent('', '', 1).run();
	}

	// Separate, because enabling and disabling rebuilds the decorations wholesale
	// and must land after the dimensions it will lay out with.
	if (setup.paginate) {
		editor.commands.enablePagination();
	} else {
		editor.commands.disablePagination();
	}
}
