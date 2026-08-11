import { describe, expect, it } from 'vitest';

import { createReferencesWatcher, shouldInsertBibliography } from './autoReferences';

const base = { enabled: true, hasCitations: true, hasBibliography: false, dismissed: false };

describe('deciding to add a references list', () => {
	it('adds one to a document that cites something and has none', () => {
		expect(shouldInsertBibliography(base)).toBe(true);
	});

	it('adds nothing to a document that cites nothing', () => {
		// An empty references heading on a document with no citations is furniture.
		expect(shouldInsertBibliography({ ...base, hasCitations: false })).toBe(false);
	});

	it('does not add a second list', () => {
		expect(shouldInsertBibliography({ ...base, hasBibliography: true })).toBe(false);
	});

	it('obeys the setting over everything else', () => {
		expect(shouldInsertBibliography({ ...base, enabled: false })).toBe(false);
	});

	it('leaves a removed list removed', () => {
		// The whole point. Putting it back would be the app arguing with the
		// author, once per keystroke.
		expect(shouldInsertBibliography({ ...base, dismissed: true })).toBe(false);
	});
});

describe('watching one document', () => {
	it('asks for a list the moment the first citation lands', () => {
		const watcher = createReferencesWatcher();

		expect(watcher.observe({ enabled: true, hasCitations: false, hasBibliography: false })).toBe(
			false
		);
		expect(watcher.observe({ enabled: true, hasCitations: true, hasBibliography: false })).toBe(
			true
		);
	});

	it('stops asking once the list exists', () => {
		const watcher = createReferencesWatcher();
		watcher.observe({ enabled: true, hasCitations: true, hasBibliography: false });

		expect(watcher.observe({ enabled: true, hasCitations: true, hasBibliography: true })).toBe(
			false
		);
	});

	it('never asks again after the author deletes it', () => {
		const watcher = createReferencesWatcher();
		watcher.observe({ enabled: true, hasCitations: true, hasBibliography: true });

		// The deletion.
		expect(watcher.observe({ enabled: true, hasCitations: true, hasBibliography: false })).toBe(
			false
		);
		expect(watcher.hasDismissed).toBe(true);

		// And it stays deleted through everything that follows.
		expect(watcher.observe({ enabled: true, hasCitations: true, hasBibliography: false })).toBe(
			false
		);
	});

	it('tells a deletion apart from a document that never had one', () => {
		// Both look like "no bibliography now". Only the history separates them,
		// which is the reason this holds state at all.
		const fresh = createReferencesWatcher();

		expect(fresh.observe({ enabled: true, hasCitations: true, hasBibliography: false })).toBe(true);
		expect(fresh.hasDismissed).toBe(false);
	});

	it('does not count a list vanishing with its last citation as a deletion', () => {
		// Removing the only citation can take the list with it. That is not the
		// author rejecting the list, and the next citation should bring one back.
		const watcher = createReferencesWatcher();
		watcher.observe({ enabled: true, hasCitations: true, hasBibliography: true });

		watcher.observe({ enabled: true, hasCitations: false, hasBibliography: false });
		expect(watcher.hasDismissed).toBe(false);

		expect(watcher.observe({ enabled: true, hasCitations: true, hasBibliography: false })).toBe(
			true
		);
	});

	it('forgets the dismissal when a different manuscript opens', () => {
		// A dismissal belongs to its document, and the editor is reused between
		// them — without this, deleting the list in one chapter would suppress it
		// in every chapter opened afterwards.
		const watcher = createReferencesWatcher();
		watcher.observe({ enabled: true, hasCitations: true, hasBibliography: true });
		watcher.observe({ enabled: true, hasCitations: true, hasBibliography: false });
		expect(watcher.hasDismissed).toBe(true);

		watcher.reset();

		expect(watcher.hasDismissed).toBe(false);
		expect(watcher.observe({ enabled: true, hasCitations: true, hasBibliography: false })).toBe(
			true
		);
	});
});
