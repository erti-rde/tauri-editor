import type { SvelteComponent } from 'svelte';
import type { SvelteHTMLElements } from 'svelte/elements';

/** An icon from `~icons/…`, as unplugin-icons types it. */
export type IconComponent = typeof SvelteComponent<SvelteHTMLElements['svg']>;
