<script module lang="ts">
	import { writable } from 'svelte/store';
	export type StatusType = {
		side: 'left' | 'right';
		message: string;
		type: 'info' | 'error' ;
	};

	const statusData = writable<StatusType | undefined>({
		side: 'left',
		message: '',
		type: 'info'
	});

	export function setStatus(status: StatusType) {
		statusData.set(status);
	}

  export function removeStatus() {
    statusData.set(undefined);
  }
</script>

<div
	class="status-bar
    fixed
    right-0
    bottom-0
    left-0
    z-50
    flex
    items-center
    justify-between
    border-t
    border-teal-900
    bg-teal-900
    px-4
    text-xs
    text-white"
>
	{#if $statusData}
		<div class="flex items-center gap-2">
			{#if $statusData.type === 'error'}
				<span class="error">X</span>
				{$statusData.message}
			{:else if $statusData.message}
				<span class="loader"></span>
				{$statusData.message}
			{/if}
		</div>
	{/if}
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
