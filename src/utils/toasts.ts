import { addToast } from '$lib/toast/Toast.svelte';


export function errorToast(message: string) {
	addToast({
		data: { description: message, title: 'error', color: 'bg-red-500' }
	});
}

export function successToast(message: string) {
	addToast({
		data: { description: message, title: 'success', color: 'bg-green-500' }
	});
}

export function infoToast(message: string) {
	addToast({
		data: { description: message, title: 'info', color: 'bg-orange-500' }
	});
}
