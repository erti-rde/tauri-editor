import { writeFileSync } from 'node:fs';

import { expect, launch, openManuscript, openProject, test } from './harness';

/**
 * The M3 Verify: following the writing costs the writer nothing they can feel.
 *
 * Typing into a 5,000-word manuscript with the Notes panel open, once
 * following and once not, in alternating rounds so a slow patch of the machine
 * lands on both. Each keystroke is timed from keydown to the frame after it
 * paints. Typing comes in bursts with a pause after each, long enough for
 * following to search and the panel to redraw, so the keystrokes after a
 * pause are the ones that would feel it.
 *
 * Run by `pnpm e2e:typing`, which records the result in
 * `e2e/typing-latency.json`. Skipped in an ordinary run: timings on a shared CI
 * machine would make it a flaky gate rather than a measurement.
 */
test.skip(!process.env.ERTI_TYPING, 'measured by `pnpm e2e:typing`');

/** The p95 difference allowed, following against not (docs/specs/M3.md). */
const BUDGET_MS = 8;
const WORDS = 5_000;
const ROUNDS = 4;
const BURSTS = 6;
const BURST = 'the attention heads parallel ';

/** Prose with the harness's notes' words in it, so following finds them. */
function manuscript(words: number): string {
	const vocabulary = (
		'sequence models recurrence attention machine translation parallel training layers ' +
		'heads encoders benchmarks results quality cost language corpus evidence claim method ' +
		'the of and a in to that is was for with as on by which'
	).split(' ');
	const paragraphs: string[] = [];
	let made = 0;
	for (let p = 0; made < words; p++) {
		const length = Math.min(80, words - made);
		const text = Array.from(
			{ length },
			(_, i) => vocabulary[(p * 7 + i * 13) % vocabulary.length]
		).join(' ');
		paragraphs.push(`<p>${text[0].toUpperCase()}${text.slice(1)}.</p>`);
		made += length;
	}
	return paragraphs.join('');
}

function p95(samples: number[]): number {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

test('typing costs the same whether the panel follows or not', async ({ page }) => {
	test.setTimeout(240_000);
	await launch(page);
	await openProject(page);
	await openManuscript(page);

	// Pasted at the end, as the writer would bring in a long draft.
	const editor = page.locator('.ProseMirror');
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.evaluate((html) => {
		const data = new DataTransfer();
		data.setData('text/html', html);
		document
			.querySelector('.ProseMirror')!
			.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
	}, manuscript(WORDS));
	const counted = await editor.evaluate(
		(node) => (node as HTMLElement).innerText.split(/\s+/).filter(Boolean).length
	);
	expect(counted).toBeGreaterThanOrEqual(WORDS);

	await page.getByRole('button', { name: 'Notes' }).click();
	const follow = page.getByRole('switch', { name: 'Follow my writing' });

	// Keydown to the frame after the change paints: the next animation frame
	// runs before paint, and a task queued from it runs after.
	await page.evaluate(() => {
		const timings: number[] = [];
		Object.assign(window, { __typing: timings });
		document.querySelector('.ProseMirror')!.addEventListener(
			'keydown',
			() => {
				const start = performance.now();
				requestAnimationFrame(() => setTimeout(() => timings.push(performance.now() - start)));
			},
			true
		);
	});
	const take = () =>
		page.evaluate(() => {
			const timings = (window as unknown as { __typing: number[] }).__typing;
			return timings.splice(0, timings.length);
		});

	const samples: Record<'following' | 'not', number[]> = { following: [], not: [] };
	let searched = 0;
	for (let round = 0; round < ROUNDS; round++) {
		const mode = round % 2 === 0 ? 'following' : 'not';
		if ((await follow.isChecked()) !== (mode === 'following')) await follow.click();

		// The middle of the manuscript, the end of a paragraph.
		// Placed through the selection rather than a click, which the page
		// footers drawn over the text would take.
		await editor.focus();
		await editor.evaluate(
			(node, index) => {
				const paragraph = node.querySelectorAll('p')[index];
				paragraph.scrollIntoView({ block: 'center' });
				const range = document.createRange();
				range.selectNodeContents(paragraph);
				range.collapse(false);
				getSelection()!.removeAllRanges();
				getSelection()!.addRange(range);
			},
			Math.floor(WORDS / 80 / 2) + round
		);
		await take();

		for (let burst = 0; burst < BURSTS; burst++) {
			await page.keyboard.type(BURST, { delay: 30 });
			// Past following's 600 ms pause, so it searches and the panel redraws.
			await page.waitForTimeout(900);
			// M3 Verify: the panel never takes focus.
			expect(await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))).toBe(
				true
			);
		}
		if (mode === 'following') {
			await expect(page.getByText(/^Related to:/)).toBeVisible();
			searched++;
		}
		samples[mode].push(...(await take()));
	}
	expect(searched).toBe(ROUNDS / 2);

	const result = {
		words: WORDS,
		keystrokes: { following: samples.following.length, not: samples.not.length },
		p50_ms: {
			following: Number(
				samples.following.sort((a, b) => a - b)[samples.following.length >> 1].toFixed(1)
			),
			not: Number(samples.not.sort((a, b) => a - b)[samples.not.length >> 1].toFixed(1))
		},
		p95_ms: {
			following: Number(p95(samples.following).toFixed(1)),
			not: Number(p95(samples.not).toFixed(1))
		},
		budget_ms: BUDGET_MS,
		browser: `${test.info().project.name} ${page.context().browser()?.version() ?? ''}`.trim(),
		measured: new Date().toISOString().slice(0, 10)
	};
	writeFileSync('e2e/typing-latency.json', `${JSON.stringify(result, null, '\t')}\n`);
	console.log(JSON.stringify(result));

	expect(result.p95_ms.following - result.p95_ms.not).toBeLessThan(BUDGET_MS);
});
