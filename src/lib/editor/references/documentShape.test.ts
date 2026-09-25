import { describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { Bibliography, BIBLIOGRAPHY_NODE } from '../extensions/citation/Bibliography';
import { Citation } from '../extensions/citation/Citation';
import { countCitations, readDocumentShape } from './documentShape';

vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn() }));
vi.mock('$lib/stores/db', () => ({ projectSources: vi.fn() }));

function docWith(content: JSONContent[]) {
	return new Editor({
		extensions: [StarterKit, Citation, Bibliography],
		content: { type: 'doc', content }
	}).state.doc;
}

const cite = (id: string) => ({ type: 'citation', attrs: { id } });
const para = (...content: JSONContent[]) => ({ type: 'paragraph', content });

describe('counting citations', () => {
	it('counts every citation, in any paragraph', () => {
		const doc = docWith([
			para({ type: 'text', text: 'One ' }, cite('a'), { type: 'text', text: ' and ' }, cite('b')),
			para(cite('a'))
		]);
		expect(countCitations(doc)).toBe(3);
	});

	it('is zero for a document with none, and ignores the reference list', () => {
		expect(countCitations(docWith([para({ type: 'text', text: 'Prose' })]))).toBe(0);
		expect(countCitations(docWith([para(cite('a')), { type: BIBLIOGRAPHY_NODE }]))).toBe(1);
	});

	it('agrees with the shape the reference list is decided on', () => {
		const doc = docWith([para(cite('a')), { type: BIBLIOGRAPHY_NODE }]);
		expect(readDocumentShape(doc)).toEqual({ hasCitations: true, hasBibliography: true });
	});
});
