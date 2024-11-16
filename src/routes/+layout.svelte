<script>
	import { Toast } from '$lib';
	import '../app.pcss';
	import '../global.css';
</script>

<div class="fixed w-full">
	<Toast />
	<slot />
</div>
