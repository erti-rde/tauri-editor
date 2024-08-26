<script lang="ts">
	import { onMount, createEventDispatcher } from 'svelte';
	import Tree from '$lib/sourceSideBar/tree/Index.svelte';
	import { Icon } from '$lib';

	export let isOpen = true;

	const dispatch = createEventDispatcher();

	$: width = isOpen ? 200 : 0;
	let isDragging = false;
	let startX: number;
	let startWidth: number;
	let isTransitioning = false;

	$: if (!isOpen) width = 0;

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

	function toggleSidebar() {
		isTransitioning = true;
		isOpen = !isOpen;
		dispatch('toggle', { isOpen });
		setTimeout(() => {
			isTransitioning = false;
		}, 300); // Match this with your transition duration
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
		<Tree />
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
