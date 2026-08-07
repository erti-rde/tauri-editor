import { describe, expect, it } from 'vitest';

import {
	DOCUMENT_EXTENSION,
	LEGACY_DOCUMENT,
	defaultDocument,
	isDocumentFile,
	listDocuments,
	toDocumentFileName
} from './documents';
import type { FileItem } from '$lib/stores/fileSystem.svelte';

const file = (name: string): FileItem => ({ name, path: `/p/${name}`, is_dir: false });
const dir = (name: string): FileItem => ({ name, path: `/p/${name}`, is_dir: true });

describe('finding the manuscripts in a project', () => {
	it('lists Erti documents and ignores everything else', () => {
		// A project folder holds PDFs, notes, exports and whatever else the
		// researcher keeps there.
		const documents = listDocuments([
			file(`chapter-one${DOCUMENT_EXTENSION}`),
			file('smith-2020.pdf'),
			file('notes.txt'),
			file('data.json'),
			dir('sources')
		]);

		expect(documents.map((d) => d.title)).toEqual(['chapter-one']);
	});

	it('recognises the single document older projects have', () => {
		// Upgrading must not hide someone's work behind a rename they did not ask
		// for, so the old hardcoded file is listed like any other manuscript.
		const documents = listDocuments([file(LEGACY_DOCUMENT)]);

		expect(documents).toHaveLength(1);
		expect(documents[0].legacy).toBe(true);
	});

	it('puts the older document first', () => {
		// For an upgrading project it is the only real manuscript, and it is what
		// the user expects to see when they open the app.
		const documents = listDocuments([
			file(`zebra${DOCUMENT_EXTENSION}`),
			file(LEGACY_DOCUMENT),
			file(`alpha${DOCUMENT_EXTENSION}`)
		]);

		expect(documents.map((d) => d.title)).toEqual(['Untitled document', 'alpha', 'zebra']);
	});

	it('does not treat a directory as a document', () => {
		expect(listDocuments([dir(`archive${DOCUMENT_EXTENSION}`)])).toEqual([]);
	});

	it('finds nothing in an empty folder', () => {
		expect(listDocuments([])).toEqual([]);
		expect(defaultDocument([])).toBeNull();
	});

	it('recognises a document by name', () => {
		expect(isDocumentFile(`thesis${DOCUMENT_EXTENSION}`)).toBe(true);
		expect(isDocumentFile(LEGACY_DOCUMENT)).toBe(true);
		expect(isDocumentFile('thesis.json')).toBe(false);
		expect(isDocumentFile('thesis.pdf')).toBe(false);
	});
});

describe('naming a new document', () => {
	it('adds the extension', () => {
		expect(toDocumentFileName('Chapter One')).toEqual({
			ok: true,
			fileName: `Chapter One${DOCUMENT_EXTENSION}`
		});
	});

	it('does not double the extension when the user types it', () => {
		expect(toDocumentFileName(`Chapter One${DOCUMENT_EXTENSION}`).fileName).toBe(
			`Chapter One${DOCUMENT_EXTENSION}`
		);
	});

	it('trims surrounding space', () => {
		expect(toDocumentFileName('  Draft  ').fileName).toBe(`Draft${DOCUMENT_EXTENSION}`);
	});

	it('refuses a name that is only space', () => {
		expect(toDocumentFileName('   ').ok).toBe(false);
	});

	it('refuses characters a filesystem will not take', () => {
		// Rejected rather than silently rewritten: a document saved under a name
		// the user did not choose is how people lose track of their own work.
		for (const name of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
			expect(toDocumentFileName(name).ok, name).toBe(false);
		}
	});

	it('refuses a name Windows reserves', () => {
		// A project folder is meant to open on a co-author's machine too.
		expect(toDocumentFileName('CON').ok).toBe(false);
		expect(toDocumentFileName('lpt1').ok).toBe(false);
	});

	it('refuses a hidden file', () => {
		expect(toDocumentFileName('.secret').ok).toBe(false);
	});

	it('refuses a name that would overwrite an existing document', () => {
		const existing = [`Chapter One${DOCUMENT_EXTENSION}`];

		expect(toDocumentFileName('Chapter One', existing).ok).toBe(false);
	});

	it('refuses one that differs only by case', () => {
		// macOS and Windows filesystems are usually case-insensitive, so this
		// would overwrite rather than create — and overwriting a co-author's
		// chapter is not a recoverable mistake.
		const existing = [`Chapter One${DOCUMENT_EXTENSION}`];

		expect(toDocumentFileName('chapter one', existing).ok).toBe(false);
	});

	it('allows a name that merely resembles an existing one', () => {
		const existing = [`Chapter One${DOCUMENT_EXTENSION}`];

		expect(toDocumentFileName('Chapter Two', existing).ok).toBe(true);
	});

	it('explains why it refused', () => {
		// The message is what the user acts on, so it has to say what to change.
		expect(toDocumentFileName('a/b').reason).toMatch(/cannot contain/i);
		expect(toDocumentFileName('', []).reason).toMatch(/name/i);
	});
});
