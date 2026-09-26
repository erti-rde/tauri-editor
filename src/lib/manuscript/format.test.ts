import { describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

import { LimitError, LIMITS } from '$lib/guard';
import { Bibliography } from '$lib/editor/extensions/citation/Bibliography';
import { Citation } from '$lib/editor/extensions/citation/Citation';
import { Notes } from '$lib/editor/extensions/citation/Notes';

import { citedIds, FORMAT, readManuscript, snapshotSources, writeManuscript } from './format';
import {
	createManuscriptSession,
	format0Backup,
	parseManuscript,
	type ManuscriptFiles
} from './io';

vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn() }));
vi.mock('$lib/stores/db', () => ({ projectSources: vi.fn() }));

const cite = (...ids: string[]) => ({
	type: 'citation',
	attrs: { id: JSON.stringify(ids), label: '(Vaswani, 2017)', noteIndex: 0 }
});
const para = (...content: JSONContent[]) => ({ type: 'paragraph', content });
const text = (t: string) => ({ type: 'text', text: t });

const DOC = {
	type: 'doc',
	content: [
		{ type: 'heading', attrs: { level: 1 }, content: [text('Chapter 1')] },
		para(text('Attention replaced recurrence '), cite('aaa'), text('.')),
		para(text('Encoders followed '), cite('bbb', 'aaa'), text('.'))
	]
};

const VASWANI = { id: 'aaa', type: 'paper-conference', title: 'Attention Is All You Need' };
const DEVLIN = { id: 'bbb', type: 'paper-conference', title: 'BERT' };

function disk(initial: Record<string, string> = {}) {
	const files = new Map(Object.entries(initial));
	const api: ManuscriptFiles = {
		exists: async (path) => files.has(path),
		read: async (path) => files.get(path)!,
		write: async (path, t, options) => {
			if (options?.createNew && files.has(path)) throw new Error('File exists (os error 17)');
			files.set(path, t);
		}
	};
	return { files, api };
}

// M1a-8 AC-1
describe('the file a manuscript is written as', () => {
	it('keeps the document at the root, with Erti’s block beside it', () => {
		const file = writeManuscript(DOC, { aaa: { ...VASWANI } }, '1.0.0');
		expect(file).toEqual({
			...DOC,
			erti: { format: 1, sources: { aaa: VASWANI }, savedWith: '1.0.0' }
		});
		expect(FORMAT).toBe(1);
	});

	it('is what a save writes, with the version that saved it', async () => {
		const { files, api } = disk();
		const session = createManuscriptSession(api, '1.2.3');
		await session.save('/p/c.erti.json', DOC, { aaa: { ...VASWANI } });
		const written = JSON.parse(files.get('/p/c.erti.json')!);
		expect(written.type).toBe('doc');
		expect(written.erti).toEqual({ format: 1, sources: { aaa: VASWANI }, savedWith: '1.2.3' });
	});

	it('never carries a stale erti block from the editor into the file twice', () => {
		const stale = { ...DOC, erti: { format: 9, sources: { x: {} } } };
		expect(writeManuscript(stale, {}, '1.0.0').erti).toEqual({
			format: 1,
			sources: {},
			savedWith: '1.0.0'
		});
	});
});

// M1a-8 AC-2
describe('the sources snapshot', () => {
	it('lists every cited id once, in order', () => {
		expect(citedIds(DOC)).toEqual(['aaa', 'bbb']);
		expect(citedIds({ type: 'doc', content: [] })).toEqual([]);
	});

	it('takes the library’s copy, keeps what the file brought, and leaves out the unknown', () => {
		const library = { aaa: { ...VASWANI, title: 'Corrected in the library', file_name: 'v.pdf' } };
		const carried = { aaa: { ...VASWANI }, bbb: { ...DEVLIN } };
		const sources = snapshotSources(['aaa', 'bbb', 'ccc'], library, carried);

		expect(sources.aaa.title).toBe('Corrected in the library');
		expect(sources.aaa).not.toHaveProperty('file_name');
		expect(sources.bbb).toEqual(DEVLIN);
		expect(sources).not.toHaveProperty('ccc');
	});

	it('names each snapshot by the id it is cited under', () => {
		const sources = snapshotSources(['aaa'], { aaa: { ...VASWANI, id: 'something-else' } }, {});
		expect(sources.aaa.id).toBe('aaa');
	});
});

// M1a-8 AC-3
describe('a file from before 1.0', () => {
	it('reads as format 0, with nothing lost', () => {
		const manuscript = readManuscript(JSON.parse(JSON.stringify(DOC)));
		expect(manuscript).toEqual({ doc: DOC, format: 0, sources: {}, newer: false });
	});

	it('comes back from the loader whole', () => {
		const loaded = parseManuscript(JSON.stringify(DOC));
		expect(loaded).toEqual({ status: 'ok', content: DOC, sources: {}, format: 0 });
	});
});

// M1a-8 AC-4
describe('a file from a newer Erti', () => {
	const newer = JSON.stringify({
		...DOC,
		erti: { format: 2, sources: { aaa: VASWANI }, savedWith: '2.0.0', somethingNew: true }
	});

	it('opens, marked as newer, with the version that wrote it', () => {
		const loaded = parseManuscript(newer);
		expect(loaded.status).toBe('newer');
		expect(loaded.content).toEqual(DOC);
		expect(loaded.status === 'newer' && loaded.savedWith).toBe('2.0.0');
	});

	it('is never saved over', async () => {
		const { files, api } = disk({ '/p/n.erti.json': newer });
		const session = createManuscriptSession(api);
		await session.open('/p/n.erti.json');

		expect(session.mayWrite('/p/n.erti.json')).toBe(false);
		expect(await session.save('/p/n.erti.json', DOC, {})).toBe(false);
		expect(files.get('/p/n.erti.json')).toBe(newer);
	});
});

// M1a-8 AC-5: the cross-version check.
describe('a format-1 file opened by Erti 0.2.5', () => {
	it('keeps every paragraph: 0.2.5 reads type and content, and ignores erti', () => {
		const file = JSON.stringify(writeManuscript(DOC, { aaa: VASWANI, bbb: DEVLIN }, '1.0.0'));

		// 0.2.5's load: `setContent(JSON.parse(file))` on an editor with its schema.
		const editor = new Editor({ extensions: [StarterKit, Citation, Notes, Bibliography] });
		editor.commands.setContent(JSON.parse(file));
		const loaded = editor.getJSON();

		const paragraphs = (loaded.content ?? []).filter((n) => n.type === 'paragraph');
		expect(paragraphs).toHaveLength(2);
		expect(editor.getText()).toContain('Attention replaced recurrence');
		expect(editor.getText()).toContain('Encoders followed');
		// And the citations, with their ids: the words and what they cite survive.
		expect(citedIds(loaded)).toEqual(['aaa', 'bbb']);
		// What it would save back: the words, without the sources. Degradation, not loss.
		expect(loaded).not.toHaveProperty('erti');
		editor.destroy();
	});
});

// M1a-8 AC-7
describe('upgrading a file from before 1.0', () => {
	const old = JSON.stringify(DOC);

	it('keeps a copy of it as it was, beside it, before the first save', async () => {
		const { files, api } = disk({ '/p/c.erti.json': old });
		const session = createManuscriptSession(api);
		await session.open('/p/c.erti.json');
		await session.save('/p/c.erti.json', DOC, {});

		expect(files.get(format0Backup('/p/c.erti.json'))).toBe(old);
		expect(JSON.parse(files.get('/p/c.erti.json')!).erti.format).toBe(1);
	});

	it('makes the copy once, and never over an earlier one', async () => {
		const { files, api } = disk({
			'/p/c.erti.json': old,
			[format0Backup('/p/c.erti.json')]: 'an earlier copy'
		});
		const session = createManuscriptSession(api);
		await session.open('/p/c.erti.json');
		await session.save('/p/c.erti.json', DOC, {});
		await session.save('/p/c.erti.json', DOC, {});

		expect(files.get(format0Backup('/p/c.erti.json'))).toBe('an earlier copy');
	});

	it('needs no copy of a file that is already format 1', async () => {
		const { files, api } = disk({
			'/p/c.erti.json': JSON.stringify(writeManuscript(DOC, {}, '1.0.0'))
		});
		const session = createManuscriptSession(api);
		await session.open('/p/c.erti.json');
		await session.save('/p/c.erti.json', DOC, {});

		expect(files.has(format0Backup('/p/c.erti.json'))).toBe(false);
	});
});

// M1a-8 AC-8: the shape guard (M1b-10) on the way in.
describe('a hostile manuscript', () => {
	it('keeps a script in a source title as text; sanitising is where text becomes HTML', () => {
		const title = '<script>alert(1)</script>';
		const manuscript = readManuscript({
			...DOC,
			erti: { format: 1, sources: { aaa: { type: 'book', title } } }
		});
		expect(manuscript.sources.aaa.title).toBe(title);
	});

	it('drops prototype keys from the sources and the document', () => {
		const manuscript = readManuscript(
			JSON.parse(
				`{"type":"doc","content":[],"__proto__":{"polluted":1},"erti":{"format":1,"sources":{"__proto__":{"type":"book"},"aaa":{"type":"book","__proto__":{"polluted":1}}}}}`
			)
		);
		expect(Object.keys(manuscript.sources)).toEqual(['aaa']);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it('is refused, and never saved over, when it carries a million sources', async () => {
		const sources = Object.fromEntries(
			Array.from({ length: LIMITS.manuscriptSources + 1 }, (_, i) => [`s${i}`, { type: 'book' }])
		);
		const file = JSON.stringify({ ...DOC, erti: { format: 1, sources } });
		expect(() => readManuscript(JSON.parse(file))).toThrow(LimitError);

		const { files, api } = disk({ '/p/h.erti.json': file });
		const session = createManuscriptSession(api);
		expect((await session.open('/p/h.erti.json')).status).toBe('unreadable');
		expect(await session.save('/p/h.erti.json', DOC, {})).toBe(false);
		expect(files.get('/p/h.erti.json')).toBe(file);
	});

	it('is refused when nested past the limit', () => {
		let node: Record<string, unknown> = text('deep');
		for (let i = 0; i < 1000; i++) node = { type: 'blockquote', content: [node] };
		expect(parseManuscript(JSON.stringify({ type: 'doc', content: [node] })).status).toBe(
			'unreadable'
		);
	});

	it('is refused when it is not a document at all', () => {
		expect(parseManuscript('{"format":"erti-manuscript","version":1,"doc":{}}').status).toBe(
			'unreadable'
		);
		expect(parseManuscript('[1,2,3]').status).toBe('unreadable');
	});
});
