import { writable } from 'svelte/store';
import { call, commands } from '$lib/ipc';
import type * as ipc from '$lib/ipc';

/**
 * An entry in the project folder, as `read_directory` returns it.
 *
 * Derived from the generated type (ADR 011); `children` is also allowed to be
 * absent, because tests and the document list build entries by hand.
 */
export type FileItem = Omit<ipc.FileItem, 'children'> & {
	id?: number;
	children?: FileItem[] | null;
};

interface FileSystemStore {
	items: FileItem[];
	currentPath: string;
	loading: boolean;
	error: string | null;
}

type FileSystemState = {
	currentFile: string | null;
};

function createFileSystemStore() {
	const { subscribe, update, set } = writable<FileSystemStore>({
		items: [],
		currentPath: '',
		loading: false,
		error: null
	});

	return {
		subscribe,
		set, // Allow direct state replacement if needed
		async readDirectory(path: string) {
			update((state) => ({ ...state, loading: true, error: null }));
			try {
				const items: FileItem[] = await call(commands.readDirectory(path));
				update((state) => ({
					...state,
					items,
					currentPath: path,
					loading: false
				}));
			} catch (error) {
				update((state) => ({
					...state,
					error: error instanceof Error ? error.message : String(error),
					loading: false
				}));
			}
		},
		clearError() {
			update((state) => ({ ...state, error: null }));
		}
	};
}

export const fileSystemStore = createFileSystemStore();
export const fileSystemState = $state<FileSystemState>({ currentFile: null });
