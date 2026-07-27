import { writable, get } from 'svelte/store';
import type Database from '@tauri-apps/plugin-sql';

type DatabaseStore = {
	db: Database | null;
	isLoading: boolean;
	error: Error | null;
};
export const dbStore = createDbStore();

/**
 * True when the statement returns rows and must go to `db.select` rather than
 * `db.execute`.
 *
 * Decided by the leading keyword, not by whether "select" appears anywhere:
 * `INSERT INTO chunks SELECT …` and `UPDATE selections …` both contain the
 * word but are writes, and routing them to `select` fails or silently discards
 * the write. Leading comments and parenthesised CTE bodies are skipped first.
 */
export function isReadQuery(query: string): boolean {
	const stripped = query
		.replace(/--[^\n]*/g, ' ') // line comments
		.replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
		.replace(/^[\s(]+/, '') // leading whitespace and parens
		.toLowerCase();

	// A CTE is read-only only if what follows the WITH block is a SELECT.
	if (/^with\b/.test(stripped)) {
		return /\bselect\b/.test(stripped) && !/\b(insert|update|delete)\b/.test(stripped);
	}

	return /^(select|pragma|explain|values)\b/.test(stripped);
}

function createDbStore() {
	const { subscribe, set, update } = writable<DatabaseStore>({
		db: null,
		isLoading: false,
		error: null
	});

	return {
		subscribe,
		setDb: (database: Database) => {
			update((state) => ({
				...state,
				db: database,
				isLoading: false
			}));
		},
		async executeQuery(query: string, params?: (string | number)[]) {
			const dbState = get(dbStore);
			if (dbState.db) {
				try {
					if (isReadQuery(query)) {
						return await dbState.db.select(query, params);
					} else {
						return await dbState.db.execute(query, params);
					}
				} catch (error) {
					console.error('Query failed:', error);
					throw error;
				}
			}
			throw new Error('Database not initialized');
		},

		setError: (error: Error) => {
			update((state) => ({
				...state,
				error,
				isLoading: false
			}));
		},
		setLoading: (loading: boolean) => {
			update((state) => ({
				...state,
				isLoading: loading
			}));
		},
		reset: () => {
			set({
				db: null,
				isLoading: false,
				error: null
			});
		}
	};
}
