import { $, $$, browser } from '@wdio/globals';

import { openPaper, openProject, rail, snapshot } from './app.mjs';

/**
 * Journey 2 (M1a-2 AC-2): a highlight outlives the app.
 *
 * Marks are the one thing a reader makes that exists nowhere else, and they go
 * through the reader, IPC, the library database and back. A restart is the only
 * honest test that the last step happened.
 */

const PASSAGE = 'Self-attention relates every position';

/**
 * Select a passage in the text layer and release the mouse, which is what the
 * reader listens for. WebDriver can't drag a text selection in WebKitGTK, so the
 * selection is made the way the browser would make it.
 */
async function select(text) {
	await browser.execute((text) => {
		const span = [...document.querySelectorAll('.textLayer span')].find((s) =>
			s.textContent.includes(text)
		);
		const node = span.firstChild;
		const start = node.textContent.indexOf(text);
		const range = document.createRange();
		range.setStart(node, start);
		range.setEnd(node, start + text.length);
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		const box = range.getBoundingClientRect();
		span.dispatchEvent(
			new MouseEvent('mouseup', {
				bubbles: true,
				button: 0,
				clientX: box.right,
				clientY: box.bottom
			})
		);
	}, text);
}

describe('a highlight', () => {
	it('is made in the reader', async () => {
		await openProject();
		await openPaper('attention.pdf');

		await select(PASSAGE);
		await $('[data-selection-menu]').waitForDisplayed();
		await $$('[data-selection-menu] .erti-swatch')[0].click();

		await $('.erti-mark').waitForDisplayed();
	});

	it('is still there after a restart, in the reader and in Notes', async () => {
		await browser.reloadSession();
		await snapshot('marks-1-restarted');

		await openProject();
		await snapshot('marks-2-project');
		await rail('Notes');
		await snapshot('marks-3-notes');
		// Read from the page: `*=text` in WebdriverIO means link text, which
		// matches only <a>, and a mark's quote isn't a link.
		await browser.waitUntil(
			async () => (await browser.execute(() => document.body.innerText)).includes(PASSAGE),
			{ timeoutMsg: 'the highlight is not in Notes after a restart' }
		);

		await rail('Files');
		await openPaper('attention.pdf');
		await snapshot('marks-4-paper');
		await $('.erti-mark').waitForDisplayed();
	});
});
