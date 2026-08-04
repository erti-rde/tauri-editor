<script lang="ts">
	import { setConsent } from '$lib/stores/consent';

	/**
	 * First-run request for permission to look metadata up online.
	 *
	 * Erti's stated promise is that data never leaves the machine without explicit
	 * consent. Until now nothing asked, while ingest sent paper titles and page
	 * text to Crossref. This is that ask.
	 *
	 * It is written to make declining a real option rather than a dead end: the
	 * identifier scan is offline and resolved every paper in the benchmark corpus,
	 * so an offline library still works.
	 */

	interface Props {
		onchoice: (granted: boolean) => void;
	}

	const { onchoice }: Props = $props();

	let dialog: HTMLDivElement;
	let allowButton: HTMLButtonElement;
	let previouslyFocused: HTMLElement | null = null;

	// Without this a keyboard user can tab straight past the overlay and operate
	// the app behind it — while the question of whether data may leave the machine
	// is still unanswered.
	$effect(() => {
		previouslyFocused = document.activeElement as HTMLElement | null;
		allowButton?.focus();

		return () => previouslyFocused?.focus();
	});

	function trapFocus(event: KeyboardEvent) {
		if (event.key !== 'Tab' || !dialog) return;

		const focusable = dialog.querySelectorAll<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		if (focusable.length === 0) return;

		const first = focusable[0];
		const last = focusable[focusable.length - 1];

		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	async function choose(granted: boolean) {
		await setConsent(granted);
		onchoice(granted);
	}
</script>

<svelte:window onkeydown={trapFocus} />

<div class="fixed inset-0 z-100 flex items-center justify-center bg-black/50">
	<div
		bind:this={dialog}
		class="w-[520px] max-w-[90%] rounded-lg bg-white p-6 shadow-xl"
		role="dialog"
		aria-modal="true"
		aria-labelledby="consent-title"
	>
		<h2 id="consent-title" class="mb-3 text-xl font-semibold text-gray-900">
			Look up citation details online?
		</h2>

		<p class="mb-3 text-gray-700">
			Erti can fill in authors, titles and journals automatically. To do that it sends a paper's
			identifier — or, failing that, its title and the opening of its first page — to
			<span class="font-medium">doi.org</span> and <span class="font-medium">crossref.org</span>.
		</p>

		<p class="mb-3 text-gray-700">
			Nothing else is sent. Your PDFs, your notes and your writing stay on this machine either way.
		</p>

		<p class="mb-5 text-sm text-gray-600">
			If you decline, Erti still reads the identifier printed in each paper and you can paste a DOI
			or type details in yourself. You can change this later in Settings.
		</p>

		<div class="flex justify-end gap-2">
			<button
				class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
				onclick={() => choose(false)}
			>
				Stay offline
			</button>
			<button
				bind:this={allowButton}
				class="rounded-md bg-orange-500 px-4 py-2 font-medium text-white hover:bg-orange-600"
				onclick={() => choose(true)}
			>
				Allow lookups
			</button>
		</div>
	</div>
</div>
