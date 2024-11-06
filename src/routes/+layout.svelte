<script>
	import { onDestroy } from 'svelte';
	import { appWindow } from '@tauri-apps/api/window';
	import { appLocalDataDir } from '@tauri-apps/api/path';
	import { Toast, Icon, Loader } from '$lib';
	import '../app.pcss';
	import '../global.css';

	let serverIsRunning = false;
	let serverChecker = setInterval(checkIfServerIsRunning, 1000);
	let dataDirPath = '';
	appLocalDataDir().then((path) => {
		dataDirPath = path;
	});
	async function checkIfServerIsRunning() {
		// check server is running or not by pinging the endpoint

		try {
			const res = await fetch(`http://localhost:8135/ping?data_dir=${dataDirPath}`);
			if (res.status === 200) {
				serverIsRunning = true;
				clearInterval(serverChecker);
			}
		} catch (e) {
			console.error('Server is not running');
		}
	}

	onDestroy(() => {
		clearInterval(serverChecker);
	});
</script>

<div data-tauri-drag-region class="titlebar">
	<button class="titlebar-button" id="titlebar-minimize" on:click={appWindow.minimize}>
		<Icon icon="WindowMinimize" size="s" />
	</button>
	<button class="titlebar-button" id="titlebar-maximize" on:click={appWindow.toggleMaximize}>
		<Icon icon="WindowMaximize" size="s" />
	</button>
	<button class="titlebar-button" id="titlebar-close" on:click={appWindow.close}>
		<Icon icon="WindowClose" size="s" />
	</button>
</div>

<div class="mt-[30px] fixed w-full">
	{#if serverIsRunning}
		<Toast />
		<slot />
	{:else}
		<div class="flex h-screen w-screen flex-col items-center justify-center">
			<div>
				<p class="ml-10 mr-10 text-2xl">
					ML super power is not running. Please wait until it starts.
				</p>
				<p>
					This can take few minutes. We are working to make it very fast but for now this is all we
					got 🙏
				</p>
			</div>
			<Loader />
		</div>
	{/if}
</div>

<style>
	.titlebar {
		height: var(--title-bar-height);
		background: transparent;
		user-select: none;
		display: flex;
		justify-content: flex-end;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		border-bottom: solid 1px var(--border-color);
	}
	.titlebar-button {
		display: flex;
		justify-content: center;
		align-items: center;
		width: 30px;
		height: 30px;
	}
	.titlebar-button:hover {
		background: theme('colors.orange.200');
	}
</style>
