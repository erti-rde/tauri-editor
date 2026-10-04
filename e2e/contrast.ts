/**
 * Contrast as rendered (M1c-5 AC-3).
 *
 * `src/lib/theme/contrast.test.ts` checks the token pairs a designer meant.
 * This checks the pairs a primitive actually paints: the colour the browser
 * computed for each piece of text, icon, control edge and focus ring, against
 * whatever is really behind it, with every translucent layer and `opacity`
 * on the way down blended in. A token pair can pass while a component puts
 * that ink on a different surface, or at half opacity, and that is the
 * failure this is for.
 *
 * WCAG AA, as the spec says: 4.5:1 for text, 3:1 for large text (24px, or
 * 18.66px bold) and for what identifies a control (1.4.11): its boundary, an
 * icon that is its only label, the focus ring. Disabled controls are exempt,
 * as WCAG exempts them; they're drawn at half opacity on purpose.
 *
 * `measure` runs in the page (it's passed to `page.evaluate`), so everything it
 * uses is declared inside it.
 */

export interface Failure {
	specimen: string;
	what: string;
	ratio: number;
	needs: number;
}

export function measure(rootSelector: string): Failure[] {
	type Rgba = [number, number, number, number];

	const canvas = document.createElement('canvas').getContext('2d')!;
	/** Any CSS colour to RGBA, letting the canvas do the parsing. */
	function parse(css: string): Rgba {
		const direct = css.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
		if (direct)
			return [+direct[1], +direct[2], +direct[3], direct[4] === undefined ? 1 : +direct[4]];
		canvas.clearRect(0, 0, 1, 1);
		canvas.fillStyle = css;
		canvas.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
		return [r, g, b, a / 255];
	}

	/** `top` over `bottom`, which is opaque. */
	function over(top: Rgba, bottom: Rgba): Rgba {
		const a = top[3];
		return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as Rgba;
	}

	function luminance([r, g, b]: Rgba): number {
		const [R, G, B] = [r, g, b].map((v) => {
			const c = v / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * R + 0.7152 * G + 0.0722 * B;
	}

	function ratio(a: Rgba, b: Rgba): number {
		const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
		return (hi + 0.05) / (lo + 0.05);
	}

	/**
	 * What is painted behind `el`'s content, and how much `el` and its
	 * ancestors' opacity fades it: every background from the root down,
	 * blended in order.
	 */
	function backdrop(el: Element): { colour: Rgba; opacity: number; under: Rgba } {
		const chain: Element[] = [];
		for (let node: Element | null = el; node; node = node.parentElement) chain.unshift(node);
		let colour: Rgba = [255, 255, 255, 1];
		let opacity = 1;
		// What was behind the outermost faded ancestor: a faded layer shows it through.
		let under: Rgba = colour;
		for (const node of chain) {
			const style = getComputedStyle(node);
			const own = Number(style.opacity);
			if (own < 1 && opacity === 1) under = colour;
			opacity *= own;
			colour = over(parse(style.backgroundColor), colour);
		}
		return { colour, opacity, under };
	}

	/** `fg` on `el`'s backdrop, as the eye gets it. */
	function seen(el: Element, fg: Rgba): [Rgba, Rgba] {
		const { colour, opacity, under } = backdrop(el);
		const text = over(fg, colour);
		if (opacity === 1) return [text, colour];
		return [
			over([...text.slice(0, 3), opacity] as Rgba, under),
			over([...colour.slice(0, 3), opacity] as Rgba, under)
		];
	}

	const visible = (el: Element) => {
		const box = el.getBoundingClientRect();
		const style = getComputedStyle(el);
		// `sr-only` is a one-pixel clipped box: read aloud, never seen.
		return (
			box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none'
		);
	};

	const disabled = (el: Element) =>
		!!el.closest('[disabled], [aria-disabled="true"], [data-disabled]') ||
		!!el.closest('[data-state~="disabled"]');

	const failures: Failure[] = [];
	const check = (specimen: string, what: string, fg: Rgba, bg: Rgba, needs: number) => {
		const r = ratio(fg, bg);
		if (r < needs) failures.push({ specimen, what, ratio: Math.round(r * 100) / 100, needs });
	};

	const roots = [...document.querySelectorAll(rootSelector)];
	for (const root of roots) {
		const name =
			root.closest('[data-specimen]')?.getAttribute('data-specimen') ??
			root.getAttribute('data-specimen') ??
			rootSelector;
		const state = root.closest('[data-state]')?.getAttribute('data-state') ?? '';
		const specimen = state ? `${name} (${state})` : name;
		const scope = root.querySelector('[data-sample]') ?? root;

		for (const el of [scope, ...scope.querySelectorAll('*')]) {
			if (!visible(el) || disabled(el)) continue;
			const style = getComputedStyle(el);
			const label = `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}"`;

			// Text it holds directly.
			const own = [...el.childNodes].some(
				(n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()
			);
			if (own) {
				const size = parseFloat(style.fontSize);
				const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
				const [fg, bg] = seen(el, parse(style.color));
				check(specimen, `text ${label}`, fg, bg, large ? 3 : 4.5);
			}

			// What's typed, or the placeholder in its place.
			if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
				const colour = el.value ? style.color : getComputedStyle(el, '::placeholder').color;
				const words = el.value || el.placeholder;
				if (words) {
					const [fg, bg] = seen(el, parse(colour));
					check(
						specimen,
						`${el.value ? 'value' : 'placeholder'} "${words.slice(0, 30)}"`,
						fg,
						bg,
						4.5
					);
				}
			}

			// An icon that is a control's only label (1.4.11).
			if (el instanceof SVGSVGElement) {
				const control = el.closest('button, [role="button"], a');
				if (control && !control.textContent?.trim()) {
					const [fg, bg] = seen(el, parse(style.color));
					check(
						specimen,
						`icon in ${control.getAttribute('aria-label') ?? 'a control'}`,
						fg,
						bg,
						3
					);
				}
			}

			// A control's edge: its border, or its fill, against what's around it.
			const field = el.matches(
				'input:not([type="hidden"]), textarea, [data-select-trigger], [data-date-field-input], [role="switch"], [role="checkbox"], [role="radio"]'
			);
			if (field && el.parentElement) {
				const [around] = seen(el.parentElement, [0, 0, 0, 0]);
				const [edge] = seen(el.parentElement, parse(style.borderTopColor));
				const hasBorder = parseFloat(style.borderTopWidth) > 0;
				const [fill] = seen(el.parentElement, parse(style.backgroundColor));
				const best = Math.max(hasBorder ? ratio(edge, around) : 0, ratio(fill, around));
				if (best < 3) {
					failures.push({
						specimen,
						what: `boundary of ${label}`,
						ratio: Math.round(best * 100) / 100,
						needs: 3
					});
				}
			}

			// The focus ring, where focus has been forced.
			// `data-force` is set by the spec on the element it forced the state on.
			const focused = el.getAttribute('data-force') === 'focus' || el.matches(':focus-visible');
			if (focused) {
				if (style.outlineStyle === 'none') {
					failures.push({ specimen, what: `no focus ring on ${label}`, ratio: 0, needs: 3 });
					continue;
				}
				const [ring, bg] = seen(el.parentElement ?? el, parse(style.outlineColor));
				check(specimen, `focus ring on ${label}`, ring, bg, 3);
				if (parseFloat(style.outlineWidth) < 2) {
					failures.push({ specimen, what: `focus ring under 2px on ${label}`, ratio: 0, needs: 3 });
				}
			}
		}
	}
	return failures;
}
