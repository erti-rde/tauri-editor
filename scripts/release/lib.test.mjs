import { describe, expect, it } from 'vitest';

import {
	changelogSection,
	latestJson,
	missingResources,
	releaseNotes,
	releaseProblems,
	REQUIRED_RESOURCES,
	sha256sums,
	updaterPlatform
} from './lib.mjs';

const files = (version, cargoVersion = version) => ({
	packageJson: JSON.stringify({ version }),
	tauriConf: JSON.stringify({ version }),
	cargoToml: `[package]\nname = "Erti"\nversion = "${cargoVersion}"\n\n[dependencies]\nfoo = { version = "9.9.9" }\n`,
	changelog: `# Changelog\n\n## [${version}] - 2026-10-01\n\n### Features\n\n- Notes on sources\n\n## [0.2.5]\n\n- old\n`
});

describe('verifying a release', () => {
	it('passes when the versions agree with each other and the tag', () => {
		expect(releaseProblems({ ...files('1.0.0'), tag: 'v1.0.0' })).toEqual([]);
	});

	it('finds a version file that disagrees, reading Cargo.toml’s package version only', () => {
		expect(releaseProblems({ ...files('1.0.0', '0.9.0'), tag: 'v1.0.0' })).toEqual([
			'The version differs between package.json (1.0.0), tauri.conf.json (1.0.0) and Cargo.toml (0.9.0).'
		]);
	});

	it('refuses a tag that is not the version', () => {
		expect(releaseProblems({ ...files('1.0.0'), tag: 'v1.0.1' })).toContain(
			"The tag v1.0.1 doesn't match the version 1.0.0."
		);
	});

	it('refuses a release with no CHANGELOG section', () => {
		expect(releaseProblems({ ...files('1.0.0'), changelog: '', tag: 'v1.0.0' })).toContain(
			'CHANGELOG.md has no section for 1.0.0.'
		);
	});

	it('checks only the versions on a dry run with no tag', () => {
		expect(releaseProblems({ ...files('1.0.0'), changelog: '' })).toEqual([]);
	});
});

describe('the CHANGELOG section', () => {
	const changelog = files('1.0.0').changelog;

	it('is the text under its heading, up to the next', () => {
		expect(changelogSection(changelog, '1.0.0')).toBe('### Features\n\n- Notes on sources');
		expect(changelogSection(changelog, '0.2.5')).toBe('- old');
	});

	it('is not mistaken for a longer version with the same start', () => {
		expect(changelogSection('## 1.0.10\n\n- ten', '1.0.1')).toBeNull();
	});

	it('goes into the notes with the first-open guide', () => {
		const notes = releaseNotes('- Notes on sources');
		expect(notes).toMatch(/^- Notes on sources/);
		expect(notes).toContain('first-open.md');
		expect(notes).toContain('SHA256SUMS.txt');
	});
});

// M7a-1 AC-4: the smoke test fails without the model.
describe('the bundle check', () => {
	const macListing = [
		'Contents/MacOS/erti',
		...REQUIRED_RESOURCES.map((r) => `Contents/Resources/${r}`)
	];

	it('passes a bundle carrying every resource', () => {
		expect(missingResources(macListing)).toEqual([]);
	});

	it('fails a bundle without the model, naming it', () => {
		const withoutModel = macListing.filter((path) => !path.endsWith('model.onnx'));
		expect(missingResources(withoutModel)).toEqual(['resources/all-MiniLM-L6-v2/model.onnx']);
	});

	it('reads Windows paths and deb listings too', () => {
		const windows = REQUIRED_RESOURCES.map((r) => `Path = ${r.replace(/\//g, '\\')}`);
		expect(missingResources(windows)).toEqual([]);
		const deb = REQUIRED_RESOURCES.map((r) => `-rw-r--r-- root/root 1 2026 ./usr/lib/Erti/${r}`);
		expect(missingResources(deb)).toEqual([]);
	});
});

describe('the draft', () => {
	it('lists a checksum for each file, sorted by name', () => {
		const sums = sha256sums([
			{ name: 'b.deb', bytes: Buffer.from('b') },
			{ name: 'a.dmg', bytes: Buffer.from('') }
		]);
		expect(sums).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  a.dmg\n' +
				'3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d  b.deb\n'
		);
	});

	it.each([
		['Erti_aarch64.app.tar.gz', 'darwin-aarch64'],
		['Erti_x64.app.tar.gz', 'darwin-x86_64'],
		['Erti_1.0.0_x64-setup.exe', 'windows-x86_64'],
		['Erti_1.0.0_amd64.AppImage', 'linux-x86_64'],
		['Erti_1.0.0_aarch64.dmg', null],
		['Erti_1.0.0_x64_en-US.msi', null]
	])('%s updates %s', (name, platform) => {
		expect(updaterPlatform(name)).toBe(platform);
	});

	it('writes latest.json from the signed artefacts', () => {
		const manifest = latestJson({
			version: '1.0.0',
			notes: 'n',
			pubDate: '2026-10-01T00:00:00Z',
			baseUrl: 'https://github.com/erti-rde/tauri-editor/releases/download/v1.0.0',
			artefacts: [
				{ name: 'Erti_aarch64.app.tar.gz', signature: 'sig-mac\n' },
				{ name: 'Erti_1.0.0_amd64.AppImage', signature: 'sig-linux' },
				{ name: 'Erti_1.0.0_aarch64.dmg', signature: undefined }
			]
		});
		expect(manifest).toEqual({
			version: '1.0.0',
			notes: 'n',
			pub_date: '2026-10-01T00:00:00Z',
			platforms: {
				'darwin-aarch64': {
					signature: 'sig-mac',
					url: 'https://github.com/erti-rde/tauri-editor/releases/download/v1.0.0/Erti_aarch64.app.tar.gz'
				},
				'linux-x86_64': {
					signature: 'sig-linux',
					url: 'https://github.com/erti-rde/tauri-editor/releases/download/v1.0.0/Erti_1.0.0_amd64.AppImage'
				}
			}
		});
	});

	it('writes no latest.json when nothing is signed', () => {
		expect(
			latestJson({
				version: '1.0.0',
				notes: '',
				pubDate: '',
				baseUrl: '',
				artefacts: [{ name: 'Erti_aarch64.app.tar.gz' }]
			})
		).toBeNull();
	});
});
