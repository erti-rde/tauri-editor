<script lang="ts" module>
	/**
	 * What kind of thing happened. Said by the icon and by the title's words,
	 * never by colour alone (design-system.md rule 4).
	 */
	export type ToastKind = 'success' | 'danger' | 'info';

	export interface ToastData {
		id: string;
		kind: ToastKind;
		/** The fact, in the past tense: "Exported Chapter 1.docx". */
		title: string;
		/** What follows from it, when the title alone doesn't say. */
		description?: string;
		/** The one way on, as a verb: "Show in folder". Running it closes the toast. */
		action?: { label: string; run: () => void };
	}

	export const toasts = $state<ToastData[]>([]);

	/** How long a toast that isn't an error stays, while nobody is reading it. */
	export const TOAST_MS = 6000;

	type Reason = 'pointer' | 'focus';

	// Bookkeeping, not state: nothing renders from these.
	const timers: Record<string, ReturnType<typeof setTimeout>> = {};
	const holding: Record<string, Reason[]> = {};
	let next = 0;

	/**
	 * Says that something happened. An error stays until it's closed, since it
	 * asks for something; anything else goes after six seconds, but not while
	 * the pointer or the keyboard is on it.
	 */
	export function toast(data: Omit<ToastData, 'id'>): string {
		const id = `toast-${next++}`;
		toasts.push({ ...data, id });
		start(id);
		return id;
	}

	export function dismissToast(id: string) {
		clearTimeout(timers[id]);
		delete timers[id];
		delete holding[id];
		const index = toasts.findIndex((t) => t.id === id);
		if (index !== -1) toasts.splice(index, 1);
	}

	function start(id: string) {
		const shown = toasts.find((t) => t.id === id);
		if (!shown || shown.kind === 'danger') return;
		clearTimeout(timers[id]);
		timers[id] = setTimeout(() => dismissToast(id), TOAST_MS);
	}

	function hold(id: string, why: Reason) {
		clearTimeout(timers[id]);
		holding[id] = [...(holding[id] ?? []).filter((r) => r !== why), why];
	}

	function release(id: string, why: Reason) {
		holding[id] = (holding[id] ?? []).filter((r) => r !== why);
		// Read in full again: the clock starts over once nothing is on it.
		if (holding[id].length === 0) start(id);
	}

	/** Something went wrong. The message is the title; the reason, if apart, the description. */
	export function errorToast(title: string, description?: string) {
		return toast({ kind: 'danger', title, description });
	}

	/** Something worked. The message is the title. */
	export function successToast(title: string, description?: string) {
		return toast({ kind: 'success', title, description });
	}
</script>

<script lang="ts">
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import CircleAlert from '~icons/lucide/circle-alert';
	import CircleCheck from '~icons/lucide/circle-check';
	import Info from '~icons/lucide/info';
	import X from '~icons/lucide/x';

	import Button from './Button.svelte';
	import IconButton from './IconButton.svelte';

	/**
	 * Where the toasts appear: bottom right, above the status footer. Rendered
	 * once, by the app's layout; `toast()` and its shorthands put them here.
	 */

	const ICONS = { success: CircleCheck, danger: CircleAlert, info: Info } as const;
	const INK = { success: 'text-success', danger: 'text-danger', info: 'text-ink-muted' } as const;

	/** The motion token, so asking for less motion stops this as it stops the rest. */
	function duration() {
		if (typeof getComputedStyle === 'undefined') return 0;
		return (
			parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration')) || 0
		);
	}

	function run(shown: ToastData) {
		shown.action?.run();
		dismissToast(shown.id);
	}
</script>

{#if toasts.length > 0}
	<div
		data-toasts
		class="fixed right-3 bottom-(--footer-status-bar-height) z-50 mb-3 flex flex-col items-end gap-2"
	>
		{#each toasts as shown (shown.id)}
			{@const Icon = ICONS[shown.kind]}
			<div
				role={shown.kind === 'danger' ? 'alert' : 'status'}
				class="bg-surface-overlay text-ink border-line-strong shadow-overlay text-small grid w-96 max-w-[calc(100vw-2rem)] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 rounded-lg border py-2 pr-1.5 pl-3"
				in:fly={{ x: 20, duration: duration() }}
				out:fly={{ x: 20, duration: duration() }}
				animate:flip={{ duration: duration() }}
				onpointerenter={() => hold(shown.id, 'pointer')}
				onpointerleave={() => release(shown.id, 'pointer')}
				onfocusin={() => hold(shown.id, 'focus')}
				onfocusout={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node | null))
						release(shown.id, 'focus');
				}}
			>
				<Icon class="mt-1 size-4 {INK[shown.kind]}" aria-hidden="true" />
				<p class="self-center font-semibold">{shown.title}</p>
				<IconButton label="Close" icon={X} size="sm" onclick={() => dismissToast(shown.id)} />
				{#if shown.description}
					<p class="text-ink-muted col-start-2">{shown.description}</p>
				{/if}
				{#if shown.action}
					<div class="col-start-2 pt-1.5">
						<Button size="sm" onclick={() => run(shown)}>{shown.action.label}</Button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
