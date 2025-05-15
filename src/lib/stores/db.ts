import { writable, get } from 'svelte/store';
import type Database from '@tauri-apps/plugin-sql';

type DatabaseStore = {
	db: Database | null;
	isLoading: boolean;
	error: Error | null;
};
export const dbStore = createDbStore();

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
          if (query.toLowerCase().includes('select')) {
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
