import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Schema } from '@tiptap/pm/model';

import {
	createWaitingCiteForTest,
	cursorMemory,
	cursorPosition,
	WAIT_MS,
	waitingCite
} from './citeLater';

beforeEach(() => {
	waitingCite.take();
	cursorMemory.reset();
});

describe('a citation asked for away from the manuscript (M1b-8)', () => {
	// M1b-8 AC-3
	it('waits until it is taken, and is taken once', () => {
		expect(waitingCite.take()).toBeNull();

		waitingCite.request({ id: 'erti:ong', locator: '78' });
		expect(get(waitingCite)).toMatchObject({ id: 'erti:ong', locator: '78' });

		expect(waitingCite.take()).toEqual({ id: 'erti:ong', locator: '78' });
		expect(waitingCite.take()).toBeNull();
	});

	it('is the latest asked for', () => {
		waitingCite.request({ id: 'a', locator: '1' });
		waitingCite.request({ id: 'b', locator: null });
		expect(waitingCite.take()).toEqual({ id: 'b', locator: null });
	});

	// Not put in unasked, much later, by an editor that opens after one failed.
	it('is let go once it has waited too long', () => {
		let now = 1_000;
		const waiting = createWaitingCiteForTest(() => now);
		waiting.request({ id: 'erti:ong', locator: '78' });

		now += WAIT_MS + 1;
		expect(waiting.take()).toBeNull();
		expect(waiting.take()).toBeNull();
	});
});

describe('where the writer left off', () => {
	it('is remembered for each manuscript', () => {
		cursorMemory.remember('/p/Chapter 1.erti.json', 120);
		cursorMemory.remember('/p/Chapter 2.erti.json', 8);
		cursorMemory.remember('/p/Chapter 1.erti.json', 140);

		expect(cursorMemory.recall('/p/Chapter 1.erti.json')).toBe(140);
		expect(cursorMemory.recall('/p/Chapter 2.erti.json')).toBe(8);
		expect(cursorMemory.recall('/p/Chapter 3.erti.json')).toBeUndefined();
		expect(cursorMemory.recall(undefined)).toBeUndefined();
	});
});

describe('the cursor remembered', () => {
	const schema = new Schema({
		nodes: {
			doc: { content: 'block+' },
			paragraph: { group: 'block', content: 'text*' },
			rule: { group: 'block' },
			text: {}
		}
	});
	const doc = schema.node('doc', null, [
		schema.node('paragraph', null, [schema.text('Before')]),
		schema.node('rule'),
		schema.node('paragraph', null, [schema.text('After')])
	]);

	it('is where text was being typed', () => {
		const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });
		expect(cursorPosition(state.selection)).toBe(3);
	});

	it('is a place text can go when a block was picked, not between blocks', () => {
		const picked = NodeSelection.create(doc, 8);
		const position = cursorPosition(picked);
		expect(doc.resolve(position).parent.isTextblock).toBe(true);
	});
});
