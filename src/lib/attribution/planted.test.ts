import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '$lib/editor/core/Editor';
import { editorExtensions } from '$lib/editor/core/extensions';
import { PLANTED, ROOT, SHA, plantedManuscript } from '$lib/harness/fixture';
import { useFakeBackend } from '$lib/harness/testing';
import { checkAttribution, openLibrary, openProject } from '$lib/stores/db';

import { classify } from './classify';
import { toChecked } from './findings';
import { walkSentences } from './sentences';

/**
 * M4 Verify, in the harness: the planted chapter returns the expected set,
 * through the fake backend the browser journeys run on and the real walk and
 * classifier. The journey (`e2e/journeys.spec.ts`) checks the same chapter
 * through the panel.
 */

useFakeBackend();

let editor: Editor | undefined;
afterEach(() => {
	editor?.destroy();
	editor = undefined;
});

describe('the planted chapter', () => {
	it('returns one finding of each kind, and nothing for the writer’s own sentence', async () => {
		await openLibrary('/library.db');
		await openProject(ROOT);
		editor = new Editor({
			element: document.createElement('div'),
			extensions: editorExtensions,
			content: plantedManuscript
		});

		const sentences = walkSentences(editor.state.doc).map((s) => toChecked(s, (id) => id));
		const name = PLANTED.split('/').pop()!;
		const matches = await checkAttribution(
			name,
			sentences.map((s) => s.text)
		);
		const found = classify(sentences, matches).map((f) => [f.sentence, f.kind, f.work]);

		expect(found).toEqual([
			[0, 'uncited', SHA.vaswani],
			[1, 'drifted_quote', SHA.vaswani],
			[2, 'wrong_source', SHA.vaswani],
			[3, 'self_reuse', 'Chapter 1.erti.json']
		]);
		expect(matches.documents).toBe(2);
	});
});
