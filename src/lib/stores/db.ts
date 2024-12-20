import { writable } from 'svelte/store';
import type Database from '@tauri-apps/plugin-sql';

type DatabaseStore = {
	db: Database | null;
	isLoading: boolean;
	error: Error | null;
};

const createDbStore = () => {
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
};

export const dbStore = createDbStore();
