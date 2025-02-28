<script lang="ts">
	import { onMount } from 'svelte';
	import Tree from '$lib/explorer/Tree.svelte';
	import { Settings } from '$lib';

	export let isExplorerOpen: boolean = false;
	export let panelName: string;

	let width = 200;
	let isDragging = false;
	let startX: number;
	let startWidth: number;
	let isTransitioning = false;

	function startResize(e: MouseEvent) {
		isDragging = true;
		startX = e.clientX;
		startWidth = width;
		e.preventDefault();
	}

	function stopResize() {
		isDragging = false;
	}

	function resize(e: MouseEvent) {
		if (isDragging) {
			const diff = e.clientX - startX;
			width = Math.max(100, startWidth + diff); // Minimum width of 100px
		}
	}

	onMount(() => {
		window.addEventListener('mousemove', resize);
		window.addEventListener('mouseup', stopResize);
		return () => {
			window.removeEventListener('mousemove', resize);
			window.removeEventListener('mouseup', stopResize);
		};
	});
</script>

<div class={isExplorerOpen ? 'sidebar-container' : 'hidden'}>
	<div
		class="explorer-scroll relative flex flex-col justify-between px-2"
		class:transitioning={isTransitioning}
		style="width: {width}px;"
	>
		{#if panelName === 'fileExplorer'}
			<Tree />
		{:else if panelName === 'settings'}
			<Settings />
		{/if}
		<div class="resizer absolute h-full w-2" on:mousedown={startResize}></div>
	</div>
</div>

<style>
	.sidebar-container {
		position: relative;
		height: 100%;
	}

	.explorer-scroll {
		overflow-y: scroll;
		height: 100%;
	}

	.explorer-scroll.transitioning {
		transition: width 0.3s ease;
	}

	.resizer {
		background-color: transparent;
		right: 0;
		cursor: col-resize;
	}
</style>
