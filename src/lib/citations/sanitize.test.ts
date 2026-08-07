import { describe, expect, it } from 'vitest';

import { sanitizeCitationHtml } from './sanitize';

/**
 * The input here is the manuscript file, not citeproc.
 *
 * Rendered citations are stored on document nodes and read back when the file
 * is opened, and manuscripts travel — a co-authored paper arrives by email as a
 * matter of course. Inside a Tauri webview, a handler that runs is a handler
 * with access to the commands that read and write the user's filesystem.
 */

describe('what a hostile manuscript cannot do', () => {
	it('strips an event handler', () => {
		// Measured before this existed: onerror survived from a document's stored
		// attributes into the rendered DOM.
		const clean = sanitizeCitationHtml('<img src=x onerror="steal()">');

		expect(clean).not.toContain('onerror');
		expect(clean).not.toContain('steal');
	});

	it('strips a script tag', () => {
		const clean = sanitizeCitationHtml('<script>fetch("http://elsewhere")</script>');

		expect(clean).not.toContain('<script');
		expect(clean).not.toContain('fetch');
	});

	it('strips a javascript: link', () => {
		const clean = sanitizeCitationHtml('<a href="javascript:steal()">Smith 2020</a>');

		expect(clean).not.toContain('javascript:');
		expect(clean).toContain('Smith 2020');
	});

	it('strips an iframe', () => {
		expect(sanitizeCitationHtml('<iframe src="http://elsewhere"></iframe>')).not.toContain(
			'iframe'
		);
	});

	it('strips an inline handler on an allowed tag', () => {
		const clean = sanitizeCitationHtml('<span onmouseover="steal()">Smith</span>');

		expect(clean).not.toContain('onmouseover');
		expect(clean).toContain('Smith');
	});
});

describe('what a citation is still allowed to be', () => {
	it('keeps the italics a style asks for', () => {
		// Measured across all five vendored styles, citeproc's whole output surface
		// is `div` and `i` with `class`.
		const entry = '<div class="csl-entry">Smith, A. <i>Coastal Erosion</i>. 2020.</div>';

		expect(sanitizeCitationHtml(entry)).toBe(entry);
	});

	it('keeps small-caps and superscripts other styles use', () => {
		const clean = sanitizeCitationHtml(
			'<span style="font-variant:small-caps;">Smith</span><sup>1</sup>'
		);

		expect(clean).toContain('small-caps');
		expect(clean).toContain('<sup>1</sup>');
	});

	it('keeps an ordinary link, as some styles render for DOIs', () => {
		const clean = sanitizeCitationHtml('<a href="https://doi.org/10.1234/x">10.1234/x</a>');

		expect(clean).toContain('https://doi.org/10.1234/x');
	});

	it('handles an empty or absent value without complaint', () => {
		expect(sanitizeCitationHtml('')).toBe('');
		expect(sanitizeCitationHtml(null as unknown as string)).toBe('');
	});
});
