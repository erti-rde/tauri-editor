import { get } from 'svelte/store';
import { dbStore } from '$lib/stores/db';

export async function executeQuery(query: string, params?: string[]) {
	const dbState = get(dbStore);
	if (dbState.db) {
		try {
			const result = await dbState.db.execute(query, params);

			return result;
		} catch (error) {
			console.error('Query failed:', error);
			throw error;
		}
	}
	throw new Error('Database not initialized');
}

export async function selectQuery(query: string, params?: string[]) {
	const dbState = get(dbStore);
	if (dbState.db) {
		try {
			const result = await dbState.db.select(query, params);

			return result;
		} catch (error) {
			console.error('Query failed:', error);
			throw error;
		}
	}
	throw new Error('Database not initialized');
}
