import { writable } from 'svelte/store';

export const currentFileStore = writable<string | null>(null);
