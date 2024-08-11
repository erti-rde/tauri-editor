<script lang="ts">
	import * as icons from './icons/index';
	type Size = 's' | 'm' | 'l';
	type Icon = keyof typeof icons;

	export let icon: Icon;
	export let size: Size = 'm';

	const sizeMap = {
		s: 16,
		m: 24,
		l: 32
	};

	const dimensions = sizeMap[size];
	const component = icons[icon];
</script>

<svelte:component this={component} width={dimensions} height={dimensions} />
