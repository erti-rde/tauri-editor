import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import { documentStatus } from './documentStatus';

/**
 * The counts moved from a row under the toolbar into the status bar, which
 * means they now travel through this store rather than through props. It is the
 * only path, so it is worth pinning.
 */

describe('what the status bar is told', () => {
	it('starts with nothing to show', () => {
		documentStatus.clear();

		expect(get(documentStatus)).toEqual({ words: null, target: 0, save: 'idle' });
	});

	it('keeps the other fields when one is reported', () => {
		// The editor reports the save state and the counts from different places,
		// and a patch that clobbered the rest would blank the bar on every save.
		documentStatus.clear();
		documentStatus.report({ target: 8000 });
		documentStatus.report({ save: 'saving' });

		expect(get(documentStatus).target).toBe(8000);
		expect(get(documentStatus).save).toBe('saving');
	});

	it('clears when the manuscript closes', () => {
		// The bar outlives the editor, so a stale count would sit there claiming a
		// document that is no longer open.
		documentStatus.report({
			words: { body: 500, references: 100, total: 600, characters: 2800 },
			target: 8000,
			save: 'idle'
		});

		documentStatus.clear();

		expect(get(documentStatus).words).toBeNull();
		expect(get(documentStatus).target).toBe(0);
	});
});
