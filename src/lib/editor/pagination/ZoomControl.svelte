<script lang="ts">
	import Minus from '~icons/lucide/minus';
	import Plus from '~icons/lucide/plus';

	import { IconButton, NumberField } from '$lib/ui';

	import { ZOOM_MAX, ZOOM_MIN, zoomStore } from './zoom';

	/**
	 * How large the page is drawn.
	 *
	 * Sits at the far left of the toolbar, where every editor that has one puts
	 * it, because it is a property of the view rather than of the selection.
	 *
	 * − and + walk the round stops a person would pick (`ZOOM_STEPS`); the box
	 * takes any percentage typed into it, 100 included, which is what the old
	 * reset button was for.
	 */

	const atMin = $derived($zoomStore <= ZOOM_MIN + 0.001);
	const atMax = $derived($zoomStore >= ZOOM_MAX - 0.001);
</script>

<IconButton
	label="Zoom out"
	icon={Minus}
	size="sm"
	disabled={atMin}
	onclick={() => zoomStore.out($zoomStore)}
/>
<NumberField
	label="Zoom"
	hideLabel
	floatNote
	value={Math.round($zoomStore * 100)}
	min={ZOOM_MIN * 100}
	max={ZOOM_MAX * 100}
	step={10}
	bigStep={50}
	unit="%"
	noun="a zoom"
	class="w-20"
	onchange={(percent) => zoomStore.set(percent / 100)}
/>
<IconButton
	label="Zoom in"
	icon={Plus}
	size="sm"
	disabled={atMax}
	onclick={() => zoomStore.in($zoomStore)}
/>
