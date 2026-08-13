import { writable, get } from 'svelte/store';

import {
	addPane,
	closeTab,
	emptyWorkspace,
	focusPane,
	moveTab,
	openTab,
	paneById,
	splitPane,
	type Tab,
	type Workspace
} from './tabs';

/**
 * The open files, live.
 *
 * `tabs.ts` is the general model and knows nothing about what a tab contains.
 * The one rule that does depend on content lives here: **a manuscript is edited
 * in one pane only.**
 *
 * Not an arbitrary limit. Two editor instances on one document would both hold
 * it, both autosave it, and the slower write would overwrite the newer one —
 * losing work silently, which is the one failure this application must not
 * have. PDFs have no such problem and may be opened anywhere, including the
 * same paper on both sides.
 *
 * So opening a manuscript in the other pane moves it rather than copying it,
 * which is also what someone dragging a chapter across actually wants.
 */

let nextPaneId = 2;

function createWorkspaceStore() {
	const { subscribe, set, update } = writable<Workspace>(emptyWorkspace());

	/** Which pane, if any, already shows this tab. */
	function paneShowing(workspace: Workspace, tabId: string, except?: string): string | undefined {
		return workspace.panes.find((p) => p.id !== except && p.tabs.includes(tabId))?.id;
	}

	return {
		subscribe,

		/** Open a file in a pane, defaulting to the focused one. */
		open(tab: Tab, paneId?: string) {
			update((workspace) => {
				const target = paneId ?? workspace.focused;

				if (tab.kind === 'document') {
					const elsewhere = paneShowing(workspace, tab.id, target);
					// Move rather than duplicate, so only one editor ever holds it.
					if (elsewhere) return openTab(moveTab(workspace, tab.id, elsewhere, target), tab, target);
				}

				return openTab(workspace, tab, target);
			});
		},

		/**
		 * Give an open tab a new identity, keeping its place in every pane.
		 *
		 * Switching chapters changes which file the manuscript tab points at.
		 * Closing and reopening would send it to the end of the row and steal
		 * focus from whatever pane you were reading in.
		 */
		rename(tabId: string, next: { id: string; title: string }) {
			update((workspace) => {
				const existing = workspace.tabs[tabId];
				if (!existing) return workspace;

				const { [tabId]: _removed, ...rest } = workspace.tabs;

				return {
					...workspace,
					tabs: { ...rest, [next.id]: { ...existing, ...next } },
					panes: workspace.panes.map((pane) => ({
						...pane,
						tabs: pane.tabs.map((id) => (id === tabId ? next.id : id)),
						active: pane.active === tabId ? next.id : pane.active
					}))
				};
			});
		},

		close(paneId: string, tabId: string) {
			update((workspace) => closeTab(workspace, paneId, tabId));
		},

		focus(paneId: string) {
			update((workspace) => focusPane(workspace, paneId));
		},

		/** Put the focused pane's file beside it. */
		split() {
			update((workspace) => {
				const source = paneById(workspace, workspace.focused);
				const active = source?.active ? workspace.tabs[source.active] : null;

				// A manuscript cannot be in two panes, so this opens an empty one
				// beside it instead — which is what splitting is for here: somewhere
				// to put the paper you are writing about. Cloning it and closing the
				// original would empty the first pane and collapse straight back to
				// one.
				if (active?.kind === 'document') return addPane(workspace, `pane-${nextPaneId++}`);

				return splitPane(workspace, `pane-${nextPaneId++}`);
			});
		},

		move(tabId: string, from: string, to: string) {
			update((workspace) => moveTab(workspace, tabId, from, to));
		},

		/** Close everything, for switching projects. */
		reset() {
			nextPaneId = 2;
			set(emptyWorkspace());
		},

		get current() {
			return get(workspaceStore);
		}
	};
}

export const workspaceStore = createWorkspaceStore();
