import DOMPurify from 'dompurify';

/**
 * Clean formatted citation HTML before it is put into the document.
 *
 * citeproc emits HTML — italics for titles, spans carrying the style's own
 * markup — so the rendered text cannot be inserted as plain text without losing
 * the formatting the style specifies. But it does not stay citeproc's output:
 * the rendered strings are stored on document nodes, saved into the manuscript
 * file, and read back through `parseHTML` when the file is opened.
 *
 * That makes the manuscript file the real input, and manuscripts travel. A
 * co-authored paper arrives by email or shared drive as a matter of course, and
 * a file carrying `<img src=x onerror=…>` in a citation label would run that
 * handler inside the webview — which, in a Tauri app, is the same context that
 * can call the commands that read and write the user's filesystem.
 *
 * Measured before this existed: both `onerror` and `<script>` survived from a
 * document's stored attributes into the rendered DOM.
 *
 * The allowlist is drawn from what citeproc actually produces. Across all five
 * vendored styles the entire output surface is `div` and `i` with `class`; the
 * rest of the list covers the inline markup other CSL styles use — small-caps
 * spans, bold, superscripts — and links, which some styles render for DOIs.
 * DOMPurify drops event handlers and `javascript:` URLs on its own.
 */

const ALLOWED_TAGS = ['i', 'b', 'em', 'strong', 'span', 'sup', 'sub', 'div', 'a', 'br'];
const ALLOWED_ATTR = ['class', 'style', 'href'];

export function sanitizeCitationHtml(html: string): string {
	if (typeof html !== 'string' || html.length === 0) return '';

	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		// A citation is a fragment of a sentence, never a document.
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false
	});
}

/**
 * Put sanitized citation HTML into an element.
 *
 * A single place to change, so a new call site cannot quietly reintroduce the
 * unsanitized assignment.
 */
export function setCitationHtml(element: HTMLElement, html: string): void {
	element.innerHTML = sanitizeCitationHtml(html);
}
