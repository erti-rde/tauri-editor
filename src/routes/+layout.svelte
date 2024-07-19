<script>
	import { onDestroy } from 'svelte';
	import 'iconify-icon';
	import { appLocalDataDir } from '@tauri-apps/api/path';
	import { Toast } from '$lib';
	import '../app.pcss';
	import { Loader } from '$lib';

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
