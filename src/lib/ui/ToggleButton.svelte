<script lang="ts">
	import type { ComponentProps } from 'svelte';

	import IconButton from './IconButton.svelte';

	/**
	 * An icon that's on or off: Bold, a marking tool, the reader's panel (M5-8).
	 *
	 * An `IconButton` whose state is always said. `aria-pressed` is there when
	 * it's off as well as on, so a screen reader hears "toggle button, not
	 * pressed" rather than an action. Pressed is drawn as ink on accent-quiet
	 * with a line-strong edge (design-system.md rule 6), so it's a shape as well
	 * as a colour.
	 */
	interface Props extends Omit<ComponentProps<typeof IconButton>, 'pressed'> {
		pressed: boolean;
	}

	let { pressed, ...rest }: Props = $props();
</script>

<IconButton {...rest} {pressed} />
