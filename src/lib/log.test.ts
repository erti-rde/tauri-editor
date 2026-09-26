import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';

import { IpcError } from '$lib/ipc';

import { catchUnhandled, describe as describeDetail, formatLine, log, withoutQuotes } from './log';

const written = vi.hoisted(() => [] as { level: string; line: string }[]);

vi.mock('@tauri-apps/plugin-log', () => {
	const writer = (level: string) => async (line: string) => {
		written.push({ level, line });
	};
	return {
		error: writer('error'),
		warn: writer('warn'),
		info: writer('info'),
		debug: writer('debug')
	};
});

beforeEach(() => {
	written.length = 0;
});

/** What someone wrote, read or noted: none of it may reach the file. */
const MANUSCRIPT = 'My supervisor thinks the second chapter is weak';
const NOTE = 'Contradicts Smith on sample size';
const QUOTE = 'attention-only models replaced recurrence';

/** Every way the app's code hands a failure to the logger, each carrying content. */
function failuresCarryingContent(): [string, unknown][] {
	const parse = (() => {
		try {
			JSON.parse(MANUSCRIPT);
		} catch (error) {
			return error;
		}
	})();
	const schema = new Schema({
		nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} }
	});
	const prosemirror = (() => {
		try {
			schema.nodeFromJSON({ type: 'doc', content: [{ type: 'text', text: MANUSCRIPT }] }).check();
		} catch (error) {
			return error;
		}
	})();

	return [
		['a JSON parse error quoting the file', parse],
		['a ProseMirror error printing the node', prosemirror],
		['an error with the text in single quotes', new Error(`Could not cite '${QUOTE}'`)],
		['an error with the text in curly quotes', new TypeError(`Unknown note “${NOTE}”`)],
		[
			'an IPC error quoting what it was given',
			new IpcError({ kind: 'Database', message: `bad "${NOTE}"` })
		],
		['a cause that carries it', new Error('Save failed', { cause: new Error(`"${MANUSCRIPT}"`) })],
		['the text itself', MANUSCRIPT],
		['a mark', { id: 'm1', quote: QUOTE, note: NOTE }],
		['a list of paragraphs', [MANUSCRIPT, NOTE]],
		['an error Rust sent back', { kind: 'Io', message: `could not write '${NOTE}'` }]
	];
}

// M1a-12 AC-4
describe('what the log never holds', () => {
	const helpers = ['error', 'warn', 'info', 'debug'] as const;

	it.each(helpers)('log.%s writes no manuscript text, note or quote', async (level) => {
		for (const [, detail] of failuresCarryingContent()) log[level]('Could not save', detail);
		await Promise.resolve();

		expect(written).toHaveLength(failuresCarryingContent().length);
		for (const { level: at, line } of written) {
			expect(at).toBe(level);
			expect(line).toMatch(/^Could not save: /);
			expect(line).not.toContain(MANUSCRIPT);
			expect(line).not.toContain(NOTE);
			expect(line).not.toContain(QUOTE);
			// Nor any recognisable piece of them.
			for (const word of ['supervi', 'chapter', 'Smith', 'recurrence']) {
				expect(line).not.toContain(word);
			}
		}
	});

	it.each(failuresCarryingContent())('is tested with %s that really carries it', (_, detail) => {
		const raw = (d: unknown): string =>
			d instanceof Error ? `${d.message} ${raw(d.cause)}` : (JSON.stringify(d) ?? '');
		expect(raw(detail)).toMatch(/My supervi|Contradicts Smith|attention-only/);
	});

	it.each(failuresCarryingContent())('says enough about %s to diagnose it', (_, detail) => {
		const said = describeDetail(detail);
		expect(said.length).toBeGreaterThan(0);
		expect(said).not.toContain(MANUSCRIPT);
	});

	it('keeps what diagnoses the fault: the error, its kind and where it was thrown', () => {
		const error = new IpcError({ kind: 'NotFound', message: '/p/Chapter 1.erti.json is gone.' });
		const line = formatLine('Could not open the chapter', error);
		expect(line).toContain('IpcError [NotFound]: /p/Chapter 1.erti.json is gone.');
		expect(line).toContain('log.test.ts');
	});

	it('takes quotes out, and leaves apostrophes alone', () => {
		expect(withoutQuotes(`Erti couldn't read "the file" or 'that' or \`this\``)).toBe(
			`Erti couldn't read "…" or '…' or \`…\``
		);
	});

	it('writes the message alone when there is no detail', () => {
		expect(formatLine('Erti started')).toBe('Erti started');
		expect(formatLine('Nothing', undefined)).toBe('Nothing: undefined');
	});

	it('caps a runaway message', () => {
		const line = formatLine('x'.repeat(5000));
		expect(line.length).toBeLessThan(400);
		expect(line).toContain('(5000 characters)');
	});
});

/** A window with just the two events, and a clock the test moves. */
function world() {
	const target = new EventTarget();
	const shown: string[] = [];
	let time = 0;
	const stop = catchUnhandled(
		target as unknown as Window,
		(m) => shown.push(m),
		() => time
	);
	const fail = (thrown: unknown) =>
		target.dispatchEvent(Object.assign(new Event('error'), { error: thrown, message: '' }));
	const reject = (reason: unknown) =>
		target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
	return { shown, stop, fail, reject, wait: (ms: number) => (time += ms) };
}

// M1a-12 AC-3
describe('an error nothing caught', () => {
	it('is logged, and said once in words', async () => {
		const { shown, fail } = world();
		fail(new TypeError('Cannot read properties of undefined (reading "id")'));
		await Promise.resolve();

		expect(shown).toEqual([
			'Something went wrong: Cannot read properties of undefined (reading "id"). Details are in the log.'
		]);
		expect(written).toHaveLength(1);
		expect(written[0].level).toBe('error');
		expect(written[0].line).toMatch(/^Uncaught error: TypeError: /);
	});

	it('is caught from a promise too', async () => {
		const { shown, reject } = world();
		reject(new IpcError({ kind: 'Database', message: 'The library is locked.' }));
		await Promise.resolve();

		expect(shown).toEqual(['Something went wrong: The library is locked. Details are in the log.']);
		expect(written[0].line).toMatch(/^Unhandled promise rejection: IpcError \[Database\]/);
	});

	it('collapses repeats into one toast and one line', async () => {
		const { shown, fail, wait } = world();
		for (let frame = 0; frame < 60; frame++) {
			fail(new Error('Could not draw'));
			wait(16);
		}
		await Promise.resolve();
		expect(shown).toHaveLength(1);
		expect(written).toHaveLength(1);
	});

	it('says it again once it has been quiet a while', () => {
		const { shown, fail, wait } = world();
		fail(new Error('Could not draw'));
		wait(6000);
		fail(new Error('Could not draw'));
		expect(shown).toHaveLength(2);
	});

	it('says two different faults separately', () => {
		const { shown, fail, reject } = world();
		fail(new Error('One thing'));
		reject(new Error('Another'));
		expect(shown).toHaveLength(2);
	});

	it('ignores what browsers raise for things that went right', () => {
		const { shown, fail } = world();
		fail(new Error('ResizeObserver loop completed with undelivered notifications.'));
		expect(shown).toEqual([]);
	});

	it('still reads without a message', () => {
		const { shown, reject } = world();
		reject(undefined);
		expect(shown).toEqual(['Something went wrong. Details are in the log.']);
	});

	it('can be taken down again', () => {
		const { shown, fail, stop } = world();
		stop();
		fail(new Error('After'));
		expect(shown).toEqual([]);
	});
});
