<script lang="ts" module>
	export type ToastData = {
		id?: string;
		title: string;
		description: string;
		color: string;
	};

	export const toasts = $state<ToastData[]>([]);

	function addToast(data: Omit<ToastData, 'id'>) {
		const id = Math.random().toString(36).substr(2, 9);
		const toast = { ...data, id };

		toasts.push(toast);

		setTimeout(() => {
			removeToast(id);
		}, 5000);

		return id;
	}

	function removeToast(id: string) {
		const index = toasts.findIndex((toast) => toast.id === id);
		if (index !== -1) {
			toasts.splice(index, 1);
		}
	}

	export function errorToast(message: string) {
		addToast({
			description: message,
			title: 'error',
			color: 'bg-red-500'
		});
	}

	export function successToast(message: string) {
		addToast({
			description: message,
			title: 'success',
			color: 'bg-green-500'
		});
	}
</script>

<script>
	import Icon from '$lib/icon/Icon.svelte';
	import { fade, fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
</script>

{#if toasts.length > 0}
	<div
		class="absolute top-0 right-0 z-50 m-4 flex flex-col items-end gap-2 md:top-auto md:bottom-0"
	>
		{#each toasts as toast (toast.id)}
			<div
				class="rounded-lg bg-neutral-800 text-white shadow-md"
				in:fly={{ x: 20, duration: 300 }}
				out:fade={{ duration: 200 }}
				animate:flip={{ duration: 200 }}
			>
				<div
					class="relative flex w-[24rem] max-w-[calc(100vw-2rem)] items-center justify-between gap-4 p-5"
				>
					<div>
						<h3 class="flex items-center gap-2 font-semibold">
							{toast.title}
							<span class="size-1.5 rounded-full {toast.color}"></span>
						</h3>
						<div>
							{toast.description}
						</div>
					</div>
					<button
						onclick={() => removeToast(toast.id as string)}
						aria-label="dismiss alert"
						class="transition-opacity hover:opacity-70"
					>
						<Icon icon="X" size="m" />
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}
