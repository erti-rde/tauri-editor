import { describe, expect, it } from 'vitest';

import { keptLine, shortPath, whatItIs, whenTaken } from './library';

/** M5-10 AC-2: the backups said as people read dates, in local time. */
describe('the library’s words', () => {
	const now = new Date(2026, 9, 20, 14, 30).getTime();

	it('M5-10 AC-2: says when a backup was taken, today, yesterday or on a date', () => {
		expect(whenTaken(new Date(2026, 9, 20, 9, 12).getTime(), now)).toBe('Today, 09:12');
		expect(whenTaken(new Date(2026, 9, 19, 18, 40).getTime(), now)).toBe('Yesterday, 18:40');
		expect(whenTaken(new Date(2026, 9, 12, 8, 5).getTime(), now)).toBe('12 October, 08:05');
		expect(whenTaken(new Date(2025, 11, 30, 23, 59).getTime(), now)).toBe(
			'30 December 2025, 23:59'
		);
	});

	it('M5-10 AC-2: tells an upgrade’s copy from a daily one, and says what’s kept', () => {
		expect(whatItIs({ beforeVersion: null })).toBe('Daily backup');
		expect(whatItIs({ beforeVersion: 6 })).toBe('Taken before an upgrade');
		expect(keptLine(7, 4)).toBe('7 daily and 4 weekly kept');
	});

	it('M5-10 AC-1: writes a path in the home folder from ~', () => {
		expect(shortPath('/Users/ada/Erti/library.db', '/Users/ada')).toBe('~/Erti/library.db');
		expect(shortPath('/Users/ada/Erti/library.db', '/Users/ada/')).toBe('~/Erti/library.db');
		expect(shortPath('/Users/adam/library.db', '/Users/ada')).toBe('/Users/adam/library.db');
		expect(shortPath('D:\\Erti\\library.db', 'C:\\Users\\ada')).toBe('D:\\Erti\\library.db');
		expect(shortPath('C:\\Users\\ada\\Erti\\library.db', 'C:\\Users\\ada')).toBe(
			'~\\Erti\\library.db'
		);
	});
});
