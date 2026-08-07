import { describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { Bibliography, BIBLIOGRAPHY_NODE } from './extensions/citation/Bibliography';
import { Citation } from './extensions/citation/Citation';
import { Notes, NOTES_NODE } from './extensions/citation/Notes';
import { countDocument, countWords, progressTo } from './wordCount';

vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn() }));
vi.mock('$lib/stores/db', () => ({ projectSources: vi.fn() }));

/**
 * The count a researcher is judged on is the one the submission form asks for,
 * and journals almost always exclude the references from it.
 */

function docWith(content: JSONContent[]) {
	return new Editor({
		extensions: [StarterKit, Citation, Notes, Bibliography],
		content: { type: 'doc', content }
	});
}

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('counting words', () => {
	it('counts as a person would', () => {
		expect(countWords('The quick brown fox')).toBe(4);
	});

	it('treats a hyphenated compound as one word', () => {
		// "well-known" is one word to a journal and to Word.
		expect(countWords('a well-known result')).toBe(3);
	});

	it('does not count punctuation as a word', () => {
		expect(countWords('Yes — really')).toBe(2);
		expect(countWords('. , ; :')).toBe(0);
	});

	it('collapses any amount of space', () => {
		expect(countWords('  one\n\ttwo   three  ')).toBe(3);
	});

	it('counts nothing in an empty document', () => {
		expect(countWords('')).toBe(0);
		expect(countWords('   \n  ')).toBe(0);
	});

	it('counts numbers and non-Latin scripts', () => {
		// Erti is for academics, not only anglophone ones.
		// Five: a lone `=` is punctuation, not a word, however a submission form
		// counts it.
		expect(countWords('p = 0.05 for 3 trials')).toBe(5);
		expect(countWords('ქართული ენა')).toBe(2);
		expect(countWords('日本語 の 研究')).toBe(3);
	});
});

describe('counting a manuscript', () => {
	it('counts the body', () => {
		const editor = docWith([para('One two three four five')]);

		expect(countDocument(editor.state.doc).body).toBe(5);
		editor.destroy();
	});

	it('keeps the references out of the body count', () => {
		// A journal limit applies to the text, not the works cited. Folding them in
		// would put an author over a limit they had not crossed.
		const editor = docWith([
			para('One two three'),
			{
				type: BIBLIOGRAPHY_NODE,
				attrs: { entries: ['Smith, A. (2020). A long entry with many words in it.'], missing: 0 }
			}
		]);

		const count = countDocument(editor.state.doc);

		expect(count.body).toBe(3);
		expect(count.total).toBeGreaterThan(count.body);
		editor.destroy();
	});

	it('keeps the notes out of the body count too', () => {
		const editor = docWith([
			para('One two three'),
			{ type: NOTES_NODE, attrs: { notes: [{ index: 1, text: 'Smith, Coastal Erosion, 101.' }] } }
		]);

		expect(countDocument(editor.state.doc).body).toBe(3);
		editor.destroy();
	});

	it('counts a citation as the words it renders', () => {
		// A citation is part of the sentence and part of the limit.
		const editor = docWith([
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'As argued ' },
					{ type: 'citation', attrs: { id: JSON.stringify(['x']), label: '(Smith, 2020)' } }
				]
			}
		]);

		// The two body words; the citation's label is an attribute, not text.
		expect(countDocument(editor.state.doc).body).toBe(2);
		editor.destroy();
	});

	it('counts nothing in an empty manuscript', () => {
		const editor = docWith([{ type: 'paragraph' }]);

		expect(countDocument(editor.state.doc)).toMatchObject({ body: 0, references: 0, total: 0 });
		editor.destroy();
	});
});

describe('progress toward a target', () => {
	it('reports how far there is to go', () => {
		expect(progressTo(2000, 5000)).toEqual({ fraction: 0.4, remaining: 3000 });
	});

	it('reports overshoot as a negative remainder', () => {
		// A journal maximum and a chapter minimum are both targets, so the sign is
		// left for the caller to interpret.
		expect(progressTo(6000, 5000).remaining).toBe(-1000);
	});

	it('does not exceed a full bar', () => {
		expect(progressTo(6000, 5000).fraction).toBe(1);
	});

	it('reports nothing when no target is set', () => {
		expect(progressTo(2000, 0)).toEqual({ fraction: 0, remaining: 0 });
		expect(progressTo(2000, Number.NaN)).toEqual({ fraction: 0, remaining: 0 });
	});
});
