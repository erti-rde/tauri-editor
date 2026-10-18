<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/**
	 * A row of controls that act on one thing: the manuscript's selection, or the
	 * paper in the reader (M5-8).
	 *
	 * One stop for Tab, as `role="toolbar"` promises: Tab enters at the first
	 * control (Shift+Tab at the last) and leaves at the next thing on the page,
	 * and the arrow keys, Home and End move along it. The editor's toolbar is
	 * thirty controls, and before this a writer tabbing to the page went through
	 * every one.
	 *
	 * Tab is handled as it's pressed rather than with a roving `tabindex`: the
	 * tooltip on every control puts its own `tabindex="0"` back each time it opens
	 * or closes, so one set here wouldn't hold. Instead, for the one keypress,
	 * every other control is taken out of the order, and the browser's own Tab
	 * then goes past them.
	 *
	 * In a text field (a `NumberField`'s box) the arrows, Home and End are the
	 * caret's, and Tab leaves.
	 */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** What it acts on: "Formatting". The toolbar's accessible name. */
		label: string;
		/** Let the groups go onto a second row in a narrow window, not out of view. */
		wrap?: boolean;
		children: Snippet;
	}

	let { label, wrap = false, class: extra, children, ...rest }: Props = $props();

	const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]';

	/** The controls the arrows move between, in order. */
	function controls(root: HTMLElement): HTMLElement[] {
		return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
			(el) =>
				!el.matches(':disabled') &&
				// A stepper is a second way to do what the arrows in its box do.
				!el.closest('[data-toolbar-skip], [hidden], [inert]')
		);
	}

	const typing = (el: HTMLElement) =>
		el instanceof HTMLTextAreaElement ||
		(el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type));

	/** Out of the order for one Tab, so it lands past the toolbar. */
	function leave(root: HTMLElement, from: HTMLElement, all: HTMLElement[]) {
		const kept = all.map((el) => [el, el.getAttribute('tabindex')] as const);
		for (const el of all) if (el !== from) el.setAttribute('tabindex', '-1');
		let done = false;
		const restore = () => {
			if (done) return;
			done = true;
			for (const [el, was] of kept) {
				if (was === null) el.removeAttribute('tabindex');
				else el.setAttribute('tabindex', was);
			}
		};
		// By the time focus leaves, the browser has chosen where it goes. The
		// timer is for a Tab that went nowhere: a window throttles it, so it
		// can't be the first way back.
		root.addEventListener('focusout', restore, { once: true });
		setTimeout(restore);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
		const root = event.currentTarget as HTMLElement;
		const target = event.target as HTMLElement;
		const all = controls(root);
		const at = all.indexOf(target);
		if (at < 0) return;

		if (event.key === 'Tab') return leave(root, target, all);
		if (typing(target)) return;

		const next =
			event.key === 'ArrowRight'
				? (at + 1) % all.length
				: event.key === 'ArrowLeft'
					? (at - 1 + all.length) % all.length
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? all.length - 1
							: null;
		if (next === null) return;
		event.preventDefault();
		all[next].focus();
	}
</script>

<div
	role="toolbar"
	aria-label={label}
	aria-orientation="horizontal"
	class={['flex min-w-0 items-center gap-1', wrap && 'flex-wrap', extra]}
	{onkeydown}
	{...rest}
>
	{@render children()}
</div>
