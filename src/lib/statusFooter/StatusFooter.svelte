<script context="module" lang="ts">
	import { writable } from 'svelte/store';
	export type StatusType = {
		side: 'left' | 'right';
		message: string;
		type: 'info' | 'error' | 'success';
	};

	const statusData = writable({
		side: 'left',
		message: '',
		type: 'info'
	});

	export function setStatus(status: StatusType) {
		statusData.set(status);
	}
</script>

<div
	class="status-bar
    fixed
    bottom-0
    left-0
    right-0
    z-50
    flex
    items-center
    justify-between
    border-t
    border-teal-900
    bg-teal-900
    px-4
    text-white"
>
	<div class="flex items-center gap-2">
		{#if $statusData.type === 'error'}
			<span class="error">X</span>
			{$statusData.message}
		{:else if $statusData.message}
			<span class="loader"></span>
			{$statusData.message}
		{/if}
	</div>
</div>

<style>
	.status-bar {
		height: var(--footer-status-bar-height);
	}
	.error {
		color: red;
		font-weight: 800;
	}
	.loader {
		width: 20px;
		height: 20px;
		border: 2px solid #fff;
		border-bottom-color: transparent;
		border-radius: 50%;
		display: inline-block;
		box-sizing: border-box;
		animation: rotation 1s linear infinite;
	}

	@keyframes rotation {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
</style>
