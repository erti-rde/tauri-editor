<script lang="ts">
	import { onMount } from 'svelte';
	import Tree from '$lib/sourceSideBar/tree/Index.svelte';
  import type {TreeItem} from './tree/Index.svelte'

	export let directoryEntries: TreeItem[];

	$: width = directoryEntries.length > 0 ? 200 : 0;
	let isDragging = false;
	let startX: number;
	let startWidth: number;
	let isTransitioning = false;

	$: if (!directoryEntries) width = 0;

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

<div class="sidebar-container">
	<div
		class="explorer-scroll relative flex flex-col justify-between px-2"
		class:transitioning={isTransitioning}
		style="width: {width}px;"
	>
		<Tree treeItems={directoryEntries} />
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
