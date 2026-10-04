/**
 * One id per work (ADR 003, M1b-3).
 *
 * A PDF attached to a book that had no file, or a duplicate merged into
 * another entry, keeps its own id in the library as an alias of the work.
 * Manuscripts may cite either, and keep doing so: a co-author's copy can't be
 * rewritten. So every id from a manuscript, a search or a note is resolved
 * before it's rendered, looked up or saved.
 *
 * The same rules as `queries::resolve` in Rust, checked against the same
 * fixture (`tests/fixtures/aliases.json`). Pure: no Svelte, no Tauri (ADR 001).
 */

/** Alias → the work it belongs to, as the library holds it. */
export type Aliases = Readonly<Record<string, string>>;

/**
 * The id a work is known by. One lookup: the library never writes a chain.
 * An id it doesn't know is its own, so a citation from another library still
 * finds the snapshot its manuscript carries.
 */
export function canonical(aliases: Aliases, id: string): string {
	return Object.hasOwn(aliases, id) ? aliases[id] : id;
}

/** Every id resolved, each work once, in the order first named. */
export function canonicalIds(aliases: Aliases, ids: readonly string[]): string[] {
	return [...new Set(ids.map((id) => canonical(aliases, id)))];
}
