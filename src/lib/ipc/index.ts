/**
 * The one way the webview calls Rust (ADR 011).
 *
 * `bindings.ts` is generated from the Rust commands, so a command's name, its
 * arguments and its result are checked by the compiler rather than discovered
 * at runtime. Nothing outside this folder imports `invoke` (enforced by ESLint).
 *
 * Generated commands resolve to `{ status, data | error }`. `call()` turns that
 * back into a value or a thrown `IpcError`, so existing `try`/`catch` code keeps
 * working while errors become typed.
 */

import { commands, type AppError, type ErrorKind } from './bindings';

export { commands };
export type * from './bindings';

/** A failure reported by Rust, with its kind kept. */
export class IpcError extends Error {
	readonly kind: ErrorKind;

	constructor(error: AppError) {
		super(error.message);
		this.name = 'IpcError';
		this.kind = error.kind;
	}
}

type Settled<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

/**
 * The value, or a thrown `IpcError`.
 *
 * An error that isn't shaped like `AppError` (only possible from a mock, or
 * from Tauri itself before a command runs) is kept as `Internal` rather than
 * lost.
 */
export async function call<T>(pending: Promise<Settled<T>>): Promise<T> {
	const result = await pending;
	if (result.status === 'ok') return result.data;
	throw new IpcError(asAppError(result.error));
}

/** For commands that return nothing: Rust's `()` arrives as `null`. */
export async function run(pending: Promise<Settled<null>>): Promise<void> {
	await call(pending);
}

function asAppError(error: unknown): AppError {
	if (
		typeof error === 'object' &&
		error !== null &&
		typeof (error as AppError).kind === 'string' &&
		typeof (error as AppError).message === 'string'
	) {
		return error as AppError;
	}
	return { kind: 'Internal', message: String(error) };
}

/**
 * An error as words a person can act on, chosen by kind.
 *
 * The one place that decides how failures read (M1a-10 AC-6). Rust already
 * writes actionable messages for files ("allow Erti access in System
 * Settings…"), so those are shown as they are. The layers whose messages are
 * technical get a plain lead-in saying what failed.
 */
export function describeError(error: unknown): string {
	if (error instanceof IpcError) {
		switch (error.kind) {
			case 'NotFound':
			case 'PermissionDenied':
			case 'InvalidInput':
			case 'Conflict':
				return error.message;
			case 'Io':
				return `A file couldn't be read or written: ${error.message}`;
			case 'Database':
				return `Erti's library couldn't be read or written: ${error.message}`;
			case 'Model':
				return `The search model isn't ready: ${error.message}`;
			case 'Network':
				return `Erti couldn't reach the network: ${error.message}`;
			case 'Internal':
				return `Something went wrong: ${error.message}`;
		}
	}
	if (error instanceof Error) return error.message;
	return String(error);
}
