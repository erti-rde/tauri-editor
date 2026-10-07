import { describe, expect, it } from 'vitest';

import {
	dateFrom,
	monthOf,
	nameFromText,
	pageRange,
	parseDate,
	richText,
	withSubtitle,
	yearOf
} from './csl';

describe('dates', () => {
	// M1b-9 AC-3
	it.each<[string, unknown]>([
		['2020', { 'date-parts': [[2020]] }],
		['2020-03', { 'date-parts': [[2020, 3]] }],
		['2020-03-05', { 'date-parts': [[2020, 3, 5]] }],
		['2019/2020', { 'date-parts': [[2019], [2020]] }],
		[
			'2020-03-05/2020-03-07',
			{
				'date-parts': [
					[2020, 3, 5],
					[2020, 3, 7]
				]
			}
		],
		['2020/', { 'date-parts': [[2020]] }],
		['2020/03', { literal: '2020/03' }],
		['2020-13', { literal: '2020-13' }],
		['in press', { literal: 'in press' }],
		['', undefined]
	])('%j', (written, date) => {
		expect(parseDate(written)).toEqual(date);
	});

	it.each<[string | undefined, string | undefined, string | undefined, unknown]>([
		['1958', 'apr', undefined, { 'date-parts': [[1958, 4]] }],
		['1958', 'April', '9', { 'date-parts': [[1958, 4, 9]] }],
		['1958', '4', undefined, { 'date-parts': [[1958, 4]] }],
		['1958', 'Spring', undefined, { 'date-parts': [[1958]] }],
		['n.d.', undefined, undefined, { literal: 'n.d.' }],
		[undefined, '4', undefined, undefined]
	])('year %j, month %j, day %j', (year, month, day, date) => {
		expect(dateFrom(year, month, day)).toEqual(date);
	});

	it('month names and numbers', () => {
		expect([monthOf('mar'), monthOf('03'), monthOf('December'), monthOf('13')]).toEqual([
			3,
			3,
			12,
			undefined
		]);
	});

	it('the year a date starts in, written either way', () => {
		expect(yearOf({ 'date-parts': [[1958, 4]] })).toBe(1958);
		expect(yearOf({ literal: 'Spring 1958' })).toBe(1958);
		expect(yearOf({ literal: 'in press' })).toBeUndefined();
		expect(yearOf(undefined)).toBeUndefined();
	});
});

describe('text', () => {
	it('keeps the markup citeproc renders, and only that', () => {
		expect(richText('A <i>B</i> <span class="nocase">C</span> <script>x</script>')).toBe(
			'A <i>B</i> C x'
		);
	});

	it('joins a subtitle with a colon, unless the title ends in its own mark', () => {
		expect(withSubtitle('Title', 'Sub')).toBe('Title: Sub');
		expect(withSubtitle('Why?', 'Sub')).toBe('Why? Sub');
		expect(withSubtitle(undefined, 'Sub')).toBe('Sub');
	});

	it('writes a page range with a hyphen, as citeproc reads it', () => {
		expect(pageRange('164–194')).toBe('164-194');
		expect(pageRange('164 -- 194')).toBe('164-194');
		expect(pageRange('xiv')).toBe('xiv');
	});

	it('reads "Family, Given, Suffix" and a name written whole', () => {
		expect(nameFromText('Pohlhaus, Gaile, Jr.')).toEqual({
			family: 'Pohlhaus',
			given: 'Gaile',
			suffix: 'Jr.'
		});
		expect(nameFromText('World Health Organization')).toEqual({
			literal: 'World Health Organization'
		});
		expect(nameFromText('  ')).toBeUndefined();
	});
});
