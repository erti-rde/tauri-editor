<!-- Working, with no count to show (for one, `ProgressLine`). Drawn in the
     palette's accent and rule, so it follows the theme like everything else. -->
<span class="loader" aria-hidden="true"></span>

<style>
	.loader {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		position: relative;
		animation: rotate 1s linear infinite;
	}
	.loader::before,
	.loader::after {
		content: '';
		box-sizing: border-box;
		position: absolute;
		inset: 0px;
		border-radius: 50%;
		border: 5px solid hsl(var(--accent));
		animation: prixClipFix 2s linear infinite;
	}
	.loader::after {
		inset: 8px;
		transform: rotate3d(90, 90, 0, 180deg);
		border-color: hsl(var(--line-strong));
	}

	/* Less motion: still turning, so it still says "working", but slowly. */
	@media (prefers-reduced-motion: reduce) {
		.loader,
		.loader::before,
		.loader::after {
			animation-duration: 4s;
		}
	}

	@keyframes rotate {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes prixClipFix {
		0% {
			clip-path: polygon(50% 50%, 0 0, 0 0, 0 0, 0 0, 0 0);
		}
		50% {
			clip-path: polygon(50% 50%, 0 0, 100% 0, 100% 0, 100% 0, 100% 0);
		}
		75%,
		100% {
			clip-path: polygon(50% 50%, 0 0, 100% 0, 100% 100%, 100% 100%, 100% 100%);
		}
	}
</style>
