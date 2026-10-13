import type { ProjectDocument } from '$lib/editor/documents';

/**
 * Which document's History is showing, if any (UX-9).
 *
 * History takes over the workspace, as Sources does, so the page shows it in
 * the editor's place. The editor is where it's asked for (the document menu),
 * and the two are siblings, so the choice lives here.
 */
class HistoryView {
	document = $state<ProjectDocument | null>(null);

	open(document: ProjectDocument) {
		this.document = document;
	}

	close() {
		this.document = null;
	}
}

export const historyView = new HistoryView();
