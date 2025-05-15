import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface FileItem {
	id?: number;
	name: string;
	path: string;
	is_dir: boolean;
	children?: FileItem[];
}

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
				const items = await invoke<FileItem[]>('read_directory', { path });
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
