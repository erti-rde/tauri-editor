import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import baseline from './design-system-baseline.json';
import { sourceFiles, withoutComments } from './sourceScan';

/**
 * The design-system ratchet (ADR 010, M1c-6).
 *
 * Outside `src/lib/ui`, UI is built from primitives. What isn't yet is counted
 * here, per file, and recorded in `design-system-baseline.json`. A file may go
 * down but never up, and a file that isn't in the baseline starts at zero. So
 * the hand-styled controls that are left get fewer with every PR that touches
 * a surface, and new ones can't arrive. Raw colours aren't counted: they're
 * forbidden outright (`rawColours.test.ts`).
 *
 * Overlays are primitives too (`Menu`, `Popover`, `Dialog`, `Tooltip`), so their
 * radius and shadow count here like any other: a menu built by hand outside
 * `src/lib/ui` is what should migrate.
 */

type Kind = 'button' | 'input' | 'textPx' | 'radius' | 'shadow';
type Counts = Partial<Record<Kind, number>>;

const KINDS: Record<
	Kind,
	{ label: string; find: RegExp; allowed?: (m: RegExpMatchArray) => boolean }
> = {
	button: { label: 'raw <button>: use Button or IconButton', find: /<button\b/g },
	input: { label: 'raw <input>: use TextField, Checkbox, Switch…', find: /<input\b/g },
	textPx: {
		label: 'text-[Npx]: use text-caption … text-display',
		find: /(?<![\w-])text-\[\d*\.?\d+(?:px|rem|em)\]/g
	},
	radius: {
		label: 'radius: rounded, rounded-full or rounded-none',
		find: /(?<![\w-])rounded(?:-(?:tl|tr|br|bl|ss|se|es|ee|t|r|b|l|s|e))?(?:-([\w.]+|\[[^\]]*\]|\([^)]*\)))?(?![\w-])/g,
		// `rounded` is 4px, the token for controls, rows and cards. `rounded-lg`
		// belongs to the overlay primitives, which live in `src/lib/ui`.
		allowed: (m) => m[1] === undefined || m[1] === 'full' || m[1] === 'none'
	},
	shadow: {
		label: 'shadow: the layout is flat; overlays are primitives',
		// Not followed by `(`: that's CSS, `filter: drop-shadow(…)`, not a class.
		find: /(?<![\w-])(?:drop-)?shadow(?:-([\w.]+|\[[^\]]*\]|\([^)]*\)))?(?![\w(-])/g,
		allowed: (m) => m[1] === 'none'
	}
};

/** What `source` has of each kind, leaving out comments and kinds it has none of. */
function count(source: string): Counts {
	const text = withoutComments(source);
	const counts: Counts = {};
	for (const [kind, { find, allowed }] of Object.entries(KINDS) as [Kind, (typeof KINDS)[Kind]][]) {
		const n = [...text.matchAll(find)].filter((m) => !allowed?.(m)).length;
		if (n) counts[kind] = n;
	}
	return counts;
}

/**
 * Today's counts against the recorded ones. `over` fails the test: a file above
 * its baseline, or a new file above zero. `dropped` doesn't: it's a surface that
 * was migrated, and the numbers to record are printed.
 */
function compare(now: Record<string, Counts>, recorded: Record<string, Counts>) {
	const over: string[] = [];
	let dropped = false;
	for (const file of new Set([...Object.keys(now), ...Object.keys(recorded)])) {
		for (const kind of Object.keys(KINDS) as Kind[]) {
			const is = now[file]?.[kind] ?? 0;
			const was = recorded[file]?.[kind] ?? 0;
			if (is > was) {
				over.push(
					`${file}: ${is} × ${KINDS[kind].label} (${recorded[file] ? `baseline ${was}` : 'a new file starts at 0'})`
				);
			}
			if (is < was) dropped = true;
		}
	}
	return { over, dropped };
}

/** The baseline as it should be written: files sorted, so a diff shows what moved. */
function record(now: Record<string, Counts>): string {
	const sorted = Object.fromEntries(Object.entries(now).sort(([a], [b]) => a.localeCompare(b)));
	return `${JSON.stringify(sorted, null, '\t')}\n`;
}

const SRC = join(process.cwd(), 'src');
const UI = join(SRC, 'lib', 'ui') + sep;

/**
 * A primitive that lives elsewhere and is exported from `$lib/ui` (`Toast`
 * keeps its place beside the store that drives it) is part of the library.
 */
const REEXPORTED = new Set(
	[...readFileSync(join(UI, 'index.ts'), 'utf8').matchAll(/from '\$lib\/([^']+\.svelte)'/g)].map(
		(m) => join(SRC, 'lib', m[1])
	)
);

function scan(): Record<string, Counts> {
	const now: Record<string, Counts> = {};
	for (const file of sourceFiles(SRC)) {
		if (file.startsWith(UI) || REEXPORTED.has(file)) continue;
		const counts = count(readFileSync(file, 'utf8'));
		// Forward slashes, so the baseline reads the same on Windows.
		if (Object.keys(counts).length)
			now[relative(process.cwd(), file).split(sep).join('/')] = counts;
	}
	return now;
}

describe('the design-system ratchet', () => {
	// M1c-6 AC-1
	it('counts raw buttons and inputs, pixel text sizes, off-token radii and shadows', () => {
		const source = `
			<button class="rounded-md shadow-sm text-[11px]">One</button>
			<button class="rounded rounded-full rounded-t rounded-b-none">Two</button>
			<input class="rounded-lg hover:shadow md:rounded-[12px] rounded-tl-xl" />
			<div class="shadow-overlay shadow-none drop-shadow-md text-[0.8rem] text-caption"></div>
			<!-- <button> in a comment is prose -->
			<div style="box-shadow: none; filter: drop-shadow(0 1px 2px)" class="--overlay-shadow"></div>
		`;
		expect(count(source)).toEqual({ button: 2, input: 1, textPx: 2, radius: 4, shadow: 4 });
	});

	// M1c-6 AC-1
	it('allows the radius tokens and a cleared shadow', () => {
		expect(
			count('<div class="rounded rounded-full rounded-none rounded-l shadow-none"></div>')
		).toEqual({});
	});

	// M1c-6 AC-2
	it('fails a file above its baseline, and a new file above zero', () => {
		const { over } = compare(
			{ 'src/a.svelte': { button: 3 }, 'src/new.svelte': { radius: 1 } },
			{ 'src/a.svelte': { button: 2 } }
		);
		expect(over).toEqual([
			'src/a.svelte: 3 × raw <button>: use Button or IconButton (baseline 2)',
			'src/new.svelte: 1 × radius: rounded, rounded-full or rounded-none (a new file starts at 0)'
		]);
	});

	// M1c-6 AC-3
	it('passes a file that dropped, and says so, removed files included', () => {
		const result = compare(
			{ 'src/a.svelte': { button: 1 } },
			{ 'src/a.svelte': { button: 2 }, 'src/gone.svelte': { input: 1 } }
		);
		expect(result).toEqual({ over: [], dropped: true });
	});

	// M1c-6 AC-2, AC-3
	it('holds every file outside src/lib/ui at or below its baseline', () => {
		const now = scan();
		const { over, dropped } = compare(now, baseline as Record<string, Counts>);
		if (dropped) {
			console.log(
				'Hand-styled UI went down. Record it: replace src/lib/theme/design-system-baseline.json with\n' +
					record(now)
			);
		}
		expect(over, 'Build it from the primitives in src/lib/ui (docs/design-system.md)').toEqual([]);
	});

	// Files in order, so a PR's diff of the baseline shows only what moved.
	it('keeps the baseline as record writes it', () => {
		expect(readFileSync(join(SRC, 'lib', 'theme', 'design-system-baseline.json'), 'utf8')).toEqual(
			record(baseline as Record<string, Counts>)
		);
	});
});
