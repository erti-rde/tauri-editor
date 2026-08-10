import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '../core/Editor';
import { paginatedExtensions } from '../core/extensions';
import { DEFAULT_PAGE_SETUP, applyPageSetup, paperById } from './index';

/**
 * The extension set the app actually builds.
 *
 * `extensions.test.ts` covers `editorExtensions`, which is the unpaginated
 * list; the running app uses `paginatedExtensions()`. That gap is exactly the
 * one that shipped an editor which could not start because a tooltip provider
 * was missing — every gate was green and nothing mounted the thing.
 *
 * jsdom reports every element as zero-height, so the paginator cannot decide
 * where a page ends here. What these do check is everything either side of that
 * measurement: that the extension registers, that its commands exist and are
 * callable, and that a setup change is applied rather than thrown.
 */

let editor: Editor | undefined;

function makeEditor(setup = DEFAULT_PAGE_SETUP, content = '<p>hello</p>') {
	editor = new Editor({
		element: document.createElement('div'),
		extensions: paginatedExtensions(setup),
		content
	});
	return editor;
}

afterEach(() => {
	editor?.destroy();
	editor = undefined;
});

describe('the paginated extension set', () => {
	it('mounts without throwing', () => {
		expect(() => makeEditor()).not.toThrow();
		expect(editor!.getHTML()).toContain('hello');
	});

	it('keeps the rest of the editor working', () => {
		// Pagination adds a plugin that rewrites decorations on every transaction,
		// which is the sort of thing that can quietly break editing.
		const e = makeEditor();

		e.commands.setContent('<p>a paragraph</p>');
		e.commands.selectAll();
		e.commands.toggleBold();

		expect(e.getHTML()).toContain('<strong>');
	});

	it('still takes the author-placed page break', () => {
		// Automatic breaks do not replace deliberate ones: a thesis needs a new
		// page at each chapter whether or not the text happens to end there.
		const e = makeEditor();

		expect(e.commands.insertPageBreak()).toBe(true);
		expect(e.getHTML()).toContain('data-type="pageBreak"');
	});

	it('registers the commands the settings panel drives', () => {
		const e = makeEditor();

		for (const command of [
			'updatePageWidth',
			'updatePageHeight',
			'updateMargins',
			'updateHeaderContent',
			'updateFooterContent',
			'enablePagination',
			'disablePagination'
		]) {
			expect(e.commands).toHaveProperty(command);
		}
	});
});

describe('applying a changed setup', () => {
	it('does not throw on a live editor', () => {
		const e = makeEditor();

		expect(() =>
			applyPageSetup(e, {
				...DEFAULT_PAGE_SETUP,
				paper: 'a4',
				margin: 'wide',
				runningHeads: {
					headerLeft: 'Running title',
					headerRight: '',
					footerLeft: 'Draft',
					footerRight: 'Page {page} of {total}'
				}
			})
		).not.toThrow();
	});

	it('records the new paper on the extension, not just in the store', () => {
		// The store change has to reach the paginator. If it does not, Settings
		// looks like it worked and the page keeps its old size.
		const e = makeEditor();
		const a4 = paperById('a4');

		applyPageSetup(e, { ...DEFAULT_PAGE_SETUP, paper: 'a4' });

		expect(e.storage.PaginationPlus.pageWidth).toBe(a4.widthPx);
		expect(e.storage.PaginationPlus.pageHeight).toBe(a4.heightPx);
	});

	it('carries the running heads through', () => {
		const e = makeEditor();

		applyPageSetup(e, {
			...DEFAULT_PAGE_SETUP,
			runningHeads: {
				headerLeft: 'A thesis',
				headerRight: '',
				footerLeft: '',
				footerRight: 'Page {page}'
			}
		});

		expect(e.storage.PaginationPlus.headerLeft).toBe('A thesis');
		expect(e.storage.PaginationPlus.footerRight).toBe('Page {page}');
	});

	it('turns pagination off and on again', () => {
		const e = makeEditor();

		applyPageSetup(e, { ...DEFAULT_PAGE_SETUP, paginate: false });
		expect(e.storage.PaginationPlus.enabled).toBe(false);

		applyPageSetup(e, { ...DEFAULT_PAGE_SETUP, paginate: true });
		expect(e.storage.PaginationPlus.enabled).toBe(true);
	});

	it('starts unpaginated when the setup says so', () => {
		// Upstream's addStorage() returns the default options rather than the
		// configured ones, and the plugin reads its state from storage — so
		// `.configure()` was dropped on the floor and someone who had turned page
		// breaks off got them back on every launch. The adapter seeds storage.
		const e = makeEditor({ ...DEFAULT_PAGE_SETUP, paginate: false });

		expect(e.storage.PaginationPlus.enabled).toBe(false);
	});

	it('starts on the paper the setup names', () => {
		// This one already worked — `onCreate` reads the dimensions from options
		// even though storage ignores them. Pinned anyway, because the adapter now
		// seeds storage and that is exactly the kind of change that can start
		// feeding stale defaults to a path which used to read the right ones.
		const a4 = paperById('a4');
		const e = makeEditor({ ...DEFAULT_PAGE_SETUP, paper: 'a4' });

		expect(e.storage.PaginationPlus.pageWidth).toBe(a4.widthPx);
		expect(e.storage.PaginationPlus.pageHeight).toBe(a4.heightPx);
	});

	it('leaves page one bare when asked', () => {
		// A title page carries no page number in any style guide. The library takes
		// per-page overrides, so this is an empty header and footer for page 1.
		const e = makeEditor({ ...DEFAULT_PAGE_SETUP, firstPageBare: true });

		expect(e.storage.PaginationPlus.customHeader[1]).toEqual({ headerLeft: '', headerRight: '' });
		expect(e.storage.PaginationPlus.customFooter[1]).toEqual({ footerLeft: '', footerRight: '' });
	});

	it('overrides nothing when it is not asked for', () => {
		// An override left behind would silently strip the page number from page
		// one of every document afterwards.
		const e = makeEditor({ ...DEFAULT_PAGE_SETUP, firstPageBare: false });

		expect(e.storage.PaginationPlus.customHeader[1]).toBeUndefined();
		expect(e.storage.PaginationPlus.customFooter[1]).toBeUndefined();
	});

	it('starts with the running heads the setup names', () => {
		const e = makeEditor({
			...DEFAULT_PAGE_SETUP,
			runningHeads: {
				headerLeft: 'Chapter draft',
				headerRight: '',
				footerLeft: '',
				footerRight: 'Page {page}'
			}
		});

		expect(e.storage.PaginationPlus.headerLeft).toBe('Chapter draft');
		expect(e.storage.PaginationPlus.footerRight).toBe('Page {page}');
	});
});
