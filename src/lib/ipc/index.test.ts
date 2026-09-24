import { describe, expect, it } from 'vitest';

import { call, describeError, IpcError, run } from './index';

const ok = <T>(data: T) => Promise.resolve({ status: 'ok' as const, data });
const failed = (error: unknown) => Promise.resolve({ status: 'error' as const, error });

/** The error a call rejected with; fails the test if it resolved instead. */
const rejection = (pending: Promise<unknown>): Promise<IpcError> =>
	pending.then(
		() => {
			throw new Error('expected the call to fail');
		},
		(error: IpcError) => error
	);

describe('calling Rust (ADR 011)', () => {
	it('returns the value of a command that succeeded', async () => {
		await expect(call(ok(['a', 'b']))).resolves.toEqual(['a', 'b']);
	});

	it('resolves to nothing for a command that returns nothing', async () => {
		await expect(run(ok(null))).resolves.toBeUndefined();
	});

	it('throws a typed error that keeps its kind (M1a-10 AC-5)', async () => {
		const error = await rejection(
			call(failed({ kind: 'PermissionDenied', message: 'Allow Erti access.' }))
		);
		expect(error).toBeInstanceOf(IpcError);
		expect(error.kind).toBe('PermissionDenied');
		expect(error.message).toBe('Allow Erti access.');
	});

	it('keeps an unshaped failure as Internal rather than losing it', async () => {
		const error = await rejection(call(failed('boom')));
		expect(error.kind).toBe('Internal');
		expect(error.message).toBe('boom');
	});
});

describe('errors as words (M1a-10 AC-6)', () => {
	const words = (kind: string, message = 'details') =>
		describeError(new IpcError({ kind: kind as never, message }));

	it('shows messages Rust already wrote for people as they are', () => {
		for (const kind of ['NotFound', 'PermissionDenied', 'InvalidInput', 'Conflict']) {
			expect(words(kind, 'Allow Erti access in System Settings.')).toBe(
				'Allow Erti access in System Settings.'
			);
		}
	});

	it('says which part failed when the message is technical', () => {
		expect(words('Database', 'database is locked')).toBe(
			"Erti's library couldn't be read or written: database is locked"
		);
		expect(words('Model')).toMatch(/^The search model isn't ready/);
		expect(words('Io')).toMatch(/^A file couldn't be read or written/);
		expect(words('Network')).toMatch(/^Erti couldn't reach the network/);
		expect(words('Internal')).toMatch(/^Something went wrong/);
	});

	it('still reads ordinary errors and anything else thrown', () => {
		expect(describeError(new Error('plain'))).toBe('plain');
		expect(describeError('text')).toBe('text');
	});
});
