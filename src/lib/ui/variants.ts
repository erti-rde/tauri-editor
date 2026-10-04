/**
 * Class names for a primitive's variants (ADR 010).
 *
 * A base, one class list per value of each option, and a default for each.
 * The twenty lines a variant library would give us, without the dependency.
 *
 *     const button = variants({
 *       base: 'inline-flex',
 *       variants: { size: { sm: 'h-5', md: 'h-(--row-height)' } },
 *       defaults: { size: 'md' }
 *     });
 *     button({ size: 'sm' }); // 'inline-flex h-5'
 */

type Options = Record<string, Record<string, string>>;
type Choice<V extends Options> = { [K in keyof V]: keyof V[K] };

export function variants<V extends Options>(config: {
	base: string;
	variants: V;
	defaults: Choice<V>;
}): (chosen?: Partial<Choice<V>>, extra?: string) => string {
	return (chosen = {}, extra) => {
		const classes = [config.base];
		for (const option of Object.keys(config.variants) as (keyof V)[]) {
			const value = chosen[option] ?? config.defaults[option];
			classes.push(config.variants[option][value as string]);
		}
		// Added after, but not over: Tailwind orders its rules itself, so an extra
		// class can't override a variant's (`px-1` beside `px-2.5` loses). A look
		// that differs is a variant of its own.
		if (extra) classes.push(extra);
		return classes.filter(Boolean).join(' ');
	};
}
