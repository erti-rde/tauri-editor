import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface FileItem {
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

function createFileSystemStore() {
	const { subscribe, set, update } = writable<FileSystemStore>({
		items: [],
		currentPath: '',
		loading: false,
		error: null
	});

	return {
		subscribe,
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
					error: error as string,
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
