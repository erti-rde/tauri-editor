/**
 * Open files, arranged the way an editor arranges them.
 *
 * A researcher reads a paper and writes about it at the same time. Until now
 * the window showed one thing: opening a PDF replaced the manuscript, and
 * getting back meant clicking the file again and losing your place. That is the
 * one workflow this application exists for, and it was the one thing the layout
 * could not do.
 *
 * So: tabs, and two panes side by side. The model is pure and lives here
 * because the interesting parts are not visual — which tab takes over when you
 * close the active one, what happens to a pane that loses its last tab, whether
 * the same file may be open twice — and each of those is a bug you only notice
 * once the answer is wrong.
 */

export type TabKind = 'document' | 'pdf';

export interface Tab {
	/** The file's path. Stable, unique, and what the pane stores. */
	id: string;
	kind: TabKind;
	title: string;
}

export interface Pane {
	id: string;
	/** Tab ids, in the order they are shown. */
	tabs: string[];
	/** The tab on show. Null only for a pane about to be removed. */
	active: string | null;
}

export interface Workspace {
	panes: Pane[];
	/** Which pane new files open into, and which one the keyboard acts on. */
	focused: string;
	/** Every open tab, by id. Shared: a file open in both panes is one entry. */
	tabs: Record<string, Tab>;
}

/** Panes are capped at two. Three columns of prose on a laptop is not reading. */
export const MAX_PANES = 2;

export function emptyWorkspace(paneId = 'pane-1'): Workspace {
	return { panes: [{ id: paneId, tabs: [], active: null }], focused: paneId, tabs: {} };
}

export function paneById(workspace: Workspace, id: string): Pane | undefined {
	return workspace.panes.find((p) => p.id === id);
}

export function focusedPane(workspace: Workspace): Pane {
	// The focused id can go stale when a pane closes; falling back to the first
	// pane keeps every caller from having to handle an impossible null.
	return paneById(workspace, workspace.focused) ?? workspace.panes[0];
}

/** The tab currently on show in a pane. */
export function activeTab(workspace: Workspace, paneId: string): Tab | null {
	const pane = paneById(workspace, paneId);
	if (!pane?.active) return null;

	return workspace.tabs[pane.active] ?? null;
}

/**
 * Open a file, or bring it forward if this pane already has it.
 *
 * Deliberately per-pane rather than global: having the same paper open beside
 * the chapter that discusses it is the point of splitting, so a file already
 * open on the left must still be openable on the right.
 */
export function openTab(workspace: Workspace, tab: Tab, paneId?: string): Workspace {
	const target = paneId ?? workspace.focused;
	const pane = paneById(workspace, target);
	if (!pane) return workspace;

	const tabs = pane.tabs.includes(tab.id) ? pane.tabs : [...pane.tabs, tab.id];

	return {
		...workspace,
		focused: target,
		// Re-registered every time, so a renamed document does not keep its old
		// title in a tab nobody thought to refresh.
		tabs: { ...workspace.tabs, [tab.id]: tab },
		panes: workspace.panes.map((p) => (p.id === target ? { ...p, tabs, active: tab.id } : p))
	};
}

/**
 * Close one tab in one pane.
 *
 * The replacement is the tab to the right, then the one to the left — which is
 * what every editor does, and what the hand expects when closing a run of tabs
 * left to right.
 */
export function closeTab(workspace: Workspace, paneId: string, tabId: string): Workspace {
	const pane = paneById(workspace, paneId);
	if (!pane || !pane.tabs.includes(tabId)) return workspace;

	const index = pane.tabs.indexOf(tabId);
	const tabs = pane.tabs.filter((id) => id !== tabId);

	// An empty pane is not a pane. The last one stays, because a window with no
	// panes has nowhere to open the next file.
	if (tabs.length === 0 && workspace.panes.length > 1) {
		const panes = workspace.panes.filter((p) => p.id !== paneId);
		return forget({
			...workspace,
			panes,
			focused: workspace.focused === paneId ? panes[0].id : workspace.focused
		});
	}

	const active = pane.active === tabId ? (tabs[index] ?? tabs[index - 1] ?? null) : pane.active;

	return forget({
		...workspace,
		panes: workspace.panes.map((p) => (p.id === paneId ? { ...p, tabs, active } : p))
	});
}

/**
 * Put the focused pane's active tab into a second pane beside it.
 *
 * The file stays open on both sides, which is what "compare these" means; the
 * alternative — moving it — leaves the pane you split from showing something
 * you were not looking at.
 */
export function splitPane(workspace: Workspace, newPaneId: string): Workspace {
	if (workspace.panes.length >= MAX_PANES) return workspace;

	const source = focusedPane(workspace);
	if (!source.active) return workspace;

	return {
		...workspace,
		panes: [...workspace.panes, { id: newPaneId, tabs: [source.active], active: source.active }],
		focused: newPaneId
	};
}

/**
 * Open a second, empty pane beside the first.
 *
 * The useful split when what you are looking at cannot be duplicated: the
 * manuscript stays where it is and you get somewhere to put a paper. An empty
 * pane is a legitimate state — it is what the window starts in.
 */
export function addPane(workspace: Workspace, newPaneId: string): Workspace {
	if (workspace.panes.length >= MAX_PANES) return workspace;

	return {
		...workspace,
		panes: [...workspace.panes, { id: newPaneId, tabs: [], active: null }],
		focused: newPaneId
	};
}

/** Move a tab from one pane to another, dropping a pane left empty. */
export function moveTab(
	workspace: Workspace,
	tabId: string,
	fromPaneId: string,
	toPaneId: string
): Workspace {
	if (fromPaneId === toPaneId) return workspace;

	const tab = workspace.tabs[tabId];
	const to = paneById(workspace, toPaneId);
	if (!tab || !to) return workspace;

	return closeTab(openTab(workspace, tab, toPaneId), fromPaneId, tabId);
}

export function focusPane(workspace: Workspace, paneId: string): Workspace {
	return paneById(workspace, paneId) ? { ...workspace, focused: paneId } : workspace;
}

/**
 * Drop tabs no pane shows any more.
 *
 * `tabs` is shared between panes, so a closed tab is only really closed once
 * the last pane showing it lets go — otherwise closing on the left would blank
 * the same file on the right.
 */
function forget(workspace: Workspace): Workspace {
	const shown = new Set(workspace.panes.flatMap((p) => p.tabs));

	return {
		...workspace,
		tabs: Object.fromEntries(Object.entries(workspace.tabs).filter(([id]) => shown.has(id)))
	};
}
