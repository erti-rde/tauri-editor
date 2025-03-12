<script lang="ts">
	import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
	import { selectQuery } from '$utils/db';
	import { currentFileStore } from '$lib/stores/openFileStore';
	import { fileSystemStore } from '$lib/stores/fileSystem';

	$inspect($currentFileStore, $fileSystemStore);

	async function selectCurrentSources() {
		let files = await selectQuery(`
            SELECT
              *, sm.file_id, sm.metadata
            FROM
              files
            LEFT JOIN
              source_metadata sm ON files.id = sm.file_id
        `);
		console.log({ files });
	}

	async function getSchema() {
		// Schema was fetched from https://api.zotero.org/schema
		// current version 33
		const cslSchema = await readTextFile('resources/csl/schema.json', {
			baseDir: BaseDirectory.Resource
		});
		return cslSchema;
	}

	selectCurrentSources();
</script>

<p>metadata</p>
