<script lang="ts">
	export let icon;
	export let size: 's' | 'm' | 'l' = 'm'

	const sizeMap = {
		s: 16,
		m: 24,
		l: 32
	};

  $: dimensions = sizeMap[size];
</script>

<iconify-icon {icon} width={dimensions} color="red"></iconify-icon>
