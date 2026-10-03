import { describe, expect, it, vi } from 'vitest';

import {
	createManuscript,
	createManuscriptSession,
	loadManuscript,
	parseManuscript,
	serialiseManuscript,
	tauriFiles,
	type ManuscriptFiles
} from './io';

vi.mock('@tauri-apps/plugin-fs', () => ({
	exists: vi.fn(async () => true),
	readTextFile: vi.fn(async () => '{"type":"doc"}'),
	writeTextFile: vi.fn(async () => undefined)
}));

/** A folder in memory, refusing `createNew` over an existing file as the OS does. */
function disk(initial: Record<string, string> = {}) {
	const files = new Map(Object.entries(initial));
	const api: ManuscriptFiles = {
		exists: async (path) => files.has(path),
		read: async (path) => {
			const text = files.get(path);
			if (text === undefined) throw new Error(`No such file: ${path}`);
			return text;
		},
		write: async (path, text, options) => {
			if (options?.createNew && files.has(path)) throw new Error('File exists (os error 17)');
			files.set(path, text);
		}
	};
	return { files, api };
}

const DOC = {
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }]
};

describe('reading a manuscript', () => {
	it('parses a document', () => {
		expect(parseManuscript(JSON.stringify(DOC))).toEqual({
			status: 'ok',
			content: DOC,
			sources: {},
			format: 0
		});
	});

	it.each(['', '   \n', 'undefined'])('treats %j as empty, to start from blank', (text) => {
		expect(parseManuscript(text)).toEqual({ status: 'empty', content: {}, sources: {} });
	});

	it('reports a file that is not a document as unreadable', () => {
		const loaded = parseManuscript('{"type":"doc", "content": [');
		expect(loaded.status).toBe('unreadable');
		expect(loaded.content).toEqual({});
		expect(loaded.status === 'unreadable' && loaded.error).toBeInstanceOf(SyntaxError);
	});

	it('treats a missing file as a new, blank document', async () => {
		expect(await loadManuscript('/p/none.erti.json', disk().api)).toEqual({
			status: 'missing',
			content: {},
			sources: {}
		});
	});

	// M1a-7 AC-2
	it('still opens magnum_opus.json, the single file older versions wrote', async () => {
		const legacy =
			'{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Thesis"}]}]}';
		const { api } = disk({ '/p/magnum_opus.json': legacy });
		const loaded = await loadManuscript('/p/magnum_opus.json', api);
		expect(loaded).toEqual({ status: 'ok', content: JSON.parse(legacy), sources: {}, format: 0 });
	});

	it('writes what it read back unchanged', () => {
		expect(parseManuscript(serialiseManuscript(DOC)).content).toEqual(DOC);
	});
});

describe('creating a manuscript', () => {
	it('writes an empty document under a free name', async () => {
		const { files, api } = disk();
		expect(await createManuscript('/p/Chapter 2.erti.json', api)).toEqual({ created: true });
		expect(JSON.parse(files.get('/p/Chapter 2.erti.json')!)).toMatchObject({
			type: 'doc',
			content: [],
			erti: { format: 1, sources: {} }
		});
	});

	it("never writes over a file that's already there", async () => {
		const { files, api } = disk({ '/p/Chapter 2.erti.json': 'a co-author wrote this' });
		const result = await createManuscript('/p/Chapter 2.erti.json', api);
		expect(result.created).toBe(false);
		expect(files.get('/p/Chapter 2.erti.json')).toBe('a co-author wrote this');
	});
});

// M1a-7 AC-2: an unparseable file is never overwritten.
describe('the read-failed guard', () => {
	const broken = '{"type":"doc","content":[{"type":"paragraph",'; // cut off mid-write

	it('refuses to save over a manuscript it could not read', async () => {
		const { files, api } = disk({ '/p/a.erti.json': broken });
		const session = createManuscriptSession(api);

		expect((await session.open('/p/a.erti.json')).status).toBe('unreadable');
		expect(session.mayWrite('/p/a.erti.json')).toBe(false);
		expect(await session.save('/p/a.erti.json', { type: 'doc', content: [] }, {})).toBe(false);
		expect(files.get('/p/a.erti.json')).toBe(broken);
	});

	it('stays up when the unreadable file is opened by switching to it', async () => {
		// Opening a chapter from the document bar reset the guard straight after
		// reading, so the next keystroke saved a blank document over the file.
		const { files, api } = disk({
			'/p/good.erti.json': JSON.stringify(DOC),
			'/p/bad.erti.json': broken
		});
		const session = createManuscriptSession(api);

		await session.open('/p/good.erti.json');
		await session.open('/p/bad.erti.json');

		expect(session.mayWrite('/p/bad.erti.json')).toBe(false);
		await session.save('/p/bad.erti.json', {}, {});
		expect(files.get('/p/bad.erti.json')).toBe(broken);
	});

	it('guards only the file that failed', async () => {
		const { files, api } = disk({
			'/p/good.erti.json': JSON.stringify(DOC),
			'/p/bad.erti.json': broken
		});
		const session = createManuscriptSession(api);
		await session.open('/p/bad.erti.json');

		expect(session.mayWrite('/p/good.erti.json')).toBe(true);
		expect(await session.save('/p/good.erti.json', DOC, {})).toBe(true);
		expect(JSON.parse(files.get('/p/good.erti.json')!)).toMatchObject(DOC);
	});

	it('lifts when a readable file is opened, or the editor moves on', async () => {
		const { api } = disk({ '/p/good.erti.json': JSON.stringify(DOC), '/p/bad.erti.json': broken });
		const session = createManuscriptSession(api);

		await session.open('/p/bad.erti.json');
		await session.open('/p/good.erti.json');
		expect(session.mayWrite('/p/bad.erti.json')).toBe(true);

		await session.open('/p/bad.erti.json');
		session.reset();
		expect(session.mayWrite('/p/bad.erti.json')).toBe(true);
	});

	it('has nowhere to save when no document is open', () => {
		expect(createManuscriptSession(disk().api).mayWrite(undefined)).toBe(false);
	});

	it('creates and checks files through the same disk', async () => {
		const { api } = disk();
		const session = createManuscriptSession(api);
		expect(await session.exists('/p/new.erti.json')).toBe(false);
		expect((await session.create('/p/new.erti.json')).created).toBe(true);
		expect(await session.exists('/p/new.erti.json')).toBe(true);
	});
});

describe('the Tauri disk', () => {
	it('passes createNew through, which is what keeps a new name from overwriting', async () => {
		const fs = await import('@tauri-apps/plugin-fs');
		await tauriFiles.write('/p/x.erti.json', '{}', { createNew: true });
		expect(fs.writeTextFile).toHaveBeenCalledWith('/p/x.erti.json', '{}', { createNew: true });
		expect(await tauriFiles.exists('/p/x.erti.json')).toBe(true);
		expect(await tauriFiles.read('/p/x.erti.json')).toBe('{"type":"doc"}');
	});
});
