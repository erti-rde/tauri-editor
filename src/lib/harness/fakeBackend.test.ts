import { describe, expect, it } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { homeDir, join } from '@tauri-apps/api/path';
import {
	BaseDirectory,
	exists,
	mkdir,
	readFile,
	readTextFile,
	writeFile,
	writeTextFile
} from '@tauri-apps/plugin-fs';
import { load as loadStore } from '@tauri-apps/plugin-store';

import { call, commands, IpcError } from '$lib/ipc';
import * as db from '$lib/stores/db';

import { fakeCommands, stateFrom, type FakeCommands } from './fakeBackend';
import { defaultFixture, MANUSCRIPT, ROOT, SHA } from './fixture';
import { useFakeBackend } from './testing';

const backend = useFakeBackend();

async function openFixtureProject() {
	await db.openLibrary('/fake/home/Erti/library.db');
	await db.openProject(ROOT);
}

describe('the contract (M1a-1 AC-2, AC-6)', () => {
	it('has a handler for every generated command', () => {
		const fake = fakeCommands(stateFrom(defaultFixture()), {
			list: () => [],
			has: () => false,
			pdfUrl: () => undefined
		});
		expect(Object.keys(fake).sort()).toEqual(Object.keys(commands).sort());
	});

	it('is typed from the bindings, so a fake that disagrees with Rust fails to compile', () => {
		// @ts-expect-error projectRoot returns a string in Rust, not a number.
		const wrongResult: FakeCommands['projectRoot'] = () => 42;
		// @ts-expect-error hashFile takes the path as a string.
		const wrongArgument: FakeCommands['hashFile'] = (path: number) => String(path);
		expect([wrongResult, wrongArgument]).toHaveLength(2);
	});

	it('refuses loudly a command it has never heard of', async () => {
		await expect(invoke('delete_everything')).rejects.toThrow(
			'Fake backend: no handler for "delete_everything"'
		);
		expect(backend().unhandled).toEqual(['delete_everything']);
	});

	it('passes arguments to the handler in the order the bindings declare them', async () => {
		await openFixtureProject();
		await db.setSourceMetadata({
			sha256: SHA.scan,
			cslJson: '{"title":"Recovered"}',
			zoteroType: 'bookSection',
			doi: '10.1/x',
			resolvedVia: 'manual'
		});

		const scan = (await db.projectSources()).find((s) => s.sha256 === SHA.scan)!;
		expect(scan).toMatchObject({
			csl_json: '{"title":"Recovered"}',
			zotero_type: 'bookSection',
			doi: '10.1/x',
			resolved_via: 'manual'
		});
	});

	// M1b-3: the same rules as `canonical_ids.rs`, so journeys see what the app would.
	it('resolves aliases as Rust does: one row per work, opening its attached file', async () => {
		await openFixtureProject();
		const { state } = backend();
		state.library.set('erti:book', {
			...state.library.get(SHA.devlin)!,
			sha256: 'erti:book',
			path: null,
			file_name: ''
		});
		state.aliases.set(SHA.devlin, 'erti:book');
		state.overrides.set(SHA.devlin, '{"title":"Made on the PDF"}');

		expect(await db.sourceAliases()).toEqual({ [SHA.devlin]: 'erti:book' });
		const listed = (await db.projectSources()).filter((s) =>
			[SHA.devlin, 'erti:book'].includes(s.sha256)
		);
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({
			sha256: 'erti:book',
			path: `${ROOT}/papers/devlin-2019.pdf`,
			file_sha256: SHA.devlin,
			csl_json: '{"title":"Made on the PDF"}'
		});
	});

	// M1b-7: the same rules as `attach_file.rs`.
	it('attaches a PDF as Rust does: an alias, a pending file, refused twice', async () => {
		await openFixtureProject();
		const { state, files } = backend();
		state.library.set('erti:book', {
			...state.library.get(SHA.devlin)!,
			sha256: 'erti:book',
			path: null,
			file_name: '',
			state: 'ready'
		});
		state.project.add('erti:book');
		files.set('/fake/home/Downloads/b.pdf', '');
		files.set('/fake/home/Downloads/a.pdf', '');

		const first = await db.attachFile('erti:book', '/fake/home/Downloads/b.pdf');
		expect(first).toMatchObject({ file_name: 'b.pdf', needs_ingest: true, merged: null });
		expect((await db.sourceAliases())[first.sha256]).toBe('erti:book');
		const row = (await db.projectSources()).find((s) => s.sha256 === 'erti:book')!;
		expect(row).toMatchObject({ state: 'ready', file_state: 'pending', file_sha256: first.sha256 });

		await db.attachFile('erti:book', '/fake/home/Downloads/a.pdf');
		expect((await db.sourceFiles('erti:book')).map((f) => f.file_name)).toEqual(['a.pdf', 'b.pdf']);

		const again = await db.attachFile('erti:book', '/fake/home/Downloads/b.pdf').catch((e) => e);
		expect(again).toBeInstanceOf(IpcError);
		expect((again as IpcError).kind).toBe('Conflict');

		// A PDF that was a source of its own says so.
		const merged = await db.attachFile('erti:book', `${ROOT}/papers/vaswani-2017.pdf`);
		expect(merged.merged).toBe('Attention Is All You Need');

		files.delete('/fake/home/Downloads/a.pdf');
		const gone = (await db.sourceFiles('erti:book')).find((f) => f.file_name === 'a.pdf')!;
		expect(gone.found).toBe(false);
	});

	// M1b-8: the same rules as `source_notes.rs`.
	it('keeps a note on the work as Rust does, and lists it with the marks on its files', async () => {
		await openFixtureProject();
		const { state } = backend();
		state.aliases.set(SHA.scan, SHA.vaswani);
		const marked = [...state.marks.values()].filter((m) => m.sha256 === SHA.vaswani).length;
		expect(marked).toBeGreaterThan(1);

		await db.saveSourceNote({
			id: 'n1',
			sha256: SHA.scan,
			body: '  On the paper  ',
			quote: ' ',
			page_label: ' 12 '
		});

		for (const id of [SHA.scan, SHA.vaswani]) {
			const listed = await db.workNotes(id);
			expect(listed.notes).toEqual([
				expect.objectContaining({
					id: 'n1',
					sha256: SHA.vaswani,
					body: 'On the paper',
					quote: null,
					page_label: '12',
					label_id: null
				})
			]);
			expect(listed.marks).toHaveLength(marked);
			const pages = listed.marks.map((m) => m.page);
			expect(pages).toEqual([...pages].sort((a, b) => a - b));
		}
		expect((await db.sourceRemoval(SHA.vaswani)).notes).toBeGreaterThanOrEqual(1);

		const empty = await db
			.saveSourceNote({ id: 'n2', sha256: SHA.vaswani, body: ' ' })
			.catch((e) => e);
		expect((empty as IpcError).kind).toBe('InvalidInput');
		const nowhere = await db
			.saveSourceNote({ id: 'n3', sha256: 'erti:gone', body: 'x' })
			.catch((e) => e);
		expect((nowhere as IpcError).kind).toBe('NotFound');

		await db.deleteSourceNote('n1');
		expect((await db.workNotes(SHA.vaswani)).notes).toEqual([]);
	});

	it('fails with a kind, as Rust does', async () => {
		const failure = await db.projectRoot().catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(IpcError);
		expect((failure as IpcError).kind).toBe('Conflict');

		// Hashing reads the file alone, so it needs nothing open, in Rust as here.
		const gone = await db.hashFile('/fake/nowhere.pdf').catch((e: unknown) => e);
		expect((gone as IpcError).kind).toBe('NotFound');
	});
});

describe('behaving like the database', () => {
	it('keeps what it is given', async () => {
		await openFixtureProject();
		await db.saveAnnotation({
			id: 'new',
			sha256: SHA.devlin,
			kind: 'page-note',
			page: 3,
			note: 'Later'
		});

		const marks = await db.allAnnotations();
		expect(marks[0]).toMatchObject({ id: 'new', note: 'Later', style: 'fill', origin: 'erti' });
	});

	it('lists every mark newest first, and without the paper, as Rust does', async () => {
		await openFixtureProject();
		const marks = await db.allAnnotations();
		expect(marks.map((m) => m.id)).toEqual(['mark-3', 'mark-2', 'mark-1']);
		expect(marks[0]).not.toHaveProperty('file_name');
	});

	it('offers a failed source for ingest again', async () => {
		await openFixtureProject();
		expect(await db.sourcesNeedingIngest()).toEqual([SHA.scan]);

		await db.storeChunks(SHA.scan, [{ text: 'Recovered text', embedding: [] }]);
		expect(await db.sourcesNeedingIngest()).toEqual([]);
	});

	it('knows a new file from one already in the library', async () => {
		await openFixtureProject();
		const known = await db.hashFile(`${ROOT}/papers/vaswani-2017.pdf`);
		expect(known).toBe(SHA.vaswani);
		expect(await db.registerSource(known, `${ROOT}/papers/vaswani-2017.pdf`, 'v.pdf')).toBe(false);
		expect(await db.registerSource('d'.repeat(64), `${ROOT}/new.pdf`, 'new.pdf')).toBe(true);
	});

	it('finds marks by their words, across the library', async () => {
		await openFixtureProject();
		const found = await db.searchAnnotations('eleven benchmarks');
		expect(found.map((m) => m.id)).toEqual(['mark-3']);
		expect(found[0]).toMatchObject({
			similarity: 1,
			in_project: true,
			file_name: 'devlin-2019.pdf'
		});
	});

	it('searches passages and marks in one list, each saying which, as Rust does (M2-1)', async () => {
		await openFixtureProject();
		const everything = await call(commands.searchLibrary('eleven benchmarks', null, 50, true));
		expect(new Set(everything.map((h) => h.kind))).toEqual(new Set(['chunk', 'annotation']));
		// The project's first, across kinds.
		const scope = everything.map((h) => h.hit.in_project);
		expect(scope).toEqual([...scope].sort((a, b) => Number(b) - Number(a)));

		const marks = await call(commands.searchLibrary('eleven benchmarks', ['annotation'], 1, null));
		expect(marks).toHaveLength(1);
		expect(marks[0]).toMatchObject({ kind: 'annotation', hit: { id: 'mark-3' } });
	});

	it('lists the project folder without its hidden files', async () => {
		backend().files.set(`${ROOT}/.erti/project.db`, '');
		const listing = await call(commands.readDirectory(ROOT));
		expect(listing.map((i) => i.name)).toEqual([
			'Chapter 1.erti.json',
			'Shared chapter.erti.json',
			'papers'
		]);
		expect(listing[2].children?.map((i) => i.name)).toEqual([
			'devlin-2019.pdf',
			'scan-chapter.pdf',
			'vaswani-2017.pdf'
		]);
	});
});

describe('the plugins', () => {
	it('keeps settings between loads, like the store file does', async () => {
		const first = await loadStore('settings-store.json');
		await first.set('wordCount', 5000);

		const again = await loadStore('settings-store.json');
		expect(await again.get('wordCount')).toBe(5000);
		expect(await again.get('recentProjects')).toEqual(
			defaultFixture().stores['settings-store.json'].recentProjects
		);
	});

	it('reads and writes files, and will not overwrite with createNew', async () => {
		expect(JSON.parse(await readTextFile(MANUSCRIPT)).type).toBe('doc');

		const path = await join(ROOT, 'Chapter 2.erti.json');
		await writeTextFile(path, '{"type":"doc","content":[]}', { createNew: true });
		expect(await exists(path)).toBe(true);
		await expect(writeTextFile(path, 'clobbered', { createNew: true })).rejects.toMatch(
			'File exists'
		);
		expect(await readTextFile(path)).toBe('{"type":"doc","content":[]}');
	});

	it('keeps a binary file byte for byte', async () => {
		// Not valid UTF-8: decoding it as text would replace these with U+FFFD.
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80]);
		await writeFile(`${ROOT}/figure.png`, png);
		await writeFile(`${ROOT}/figure.png`, new Uint8Array([0xc3]), { append: true });
		expect(Array.from(await readFile(`${ROOT}/figure.png`))).toEqual([...png, 0xc3]);
	});

	it('refuses to write into a folder that is not there', async () => {
		await expect(writeTextFile(`${ROOT}/missing/x.txt`, 'x')).rejects.toMatch('No such file');
		await mkdir(`${ROOT}/missing`, { recursive: true });
		await writeTextFile(`${ROOT}/missing/x.txt`, 'x');
		expect(await readTextFile(`${ROOT}/missing/x.txt`)).toBe('x');
	});

	it('serves the bundled resources the app ships', async () => {
		const manifest = JSON.parse(
			await readTextFile('resources/csl/bundled.json', { baseDir: BaseDirectory.Resource })
		);
		expect(manifest.styles.length).toBeGreaterThan(0);
	});

	it('answers path questions', async () => {
		expect(await homeDir()).toBe('/fake/home');
		expect(await join('/a', 'b', '../c')).toBe('/a/c');
	});
});
