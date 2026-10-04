<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * One primitive in one state, in the catalogue (M1c-5).
	 *
	 * `state` is read by `e2e/catalogue.spec.ts`: `hover`, `focus` and `active`
	 * can't be set from markup, so the spec forces them on the first control in
	 * the sample through the browser's devtools protocol, the way a person
	 * inspecting the element would. The rest (disabled, loading, error, checked)
	 * are props, set here.
	 */
	interface Props {
		name: string;
		state?: string;
		/** Which element in the sample takes a forced state, when it isn't the first control. */
		target?: string;
		children: Snippet;
	}

	let { name, state = 'rest', target, children }: Props = $props();
</script>

<figure
	class="grid content-start gap-1.5"
	data-specimen={name}
	data-state={state}
	data-target={target}
>
	<div data-sample>{@render children()}</div>
	<figcaption class="text-caption text-ink-muted">{state}</figcaption>
</figure>
