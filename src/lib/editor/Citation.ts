import type { InlineTool, API } from '@editorjs/editorjs';

export class InlineCitation implements InlineTool {
	button: HTMLButtonElement;

	static get shortcut() {
		return 'CMD+SHIFT+I';
	}
	public static isInline = true;
	public static title: string = 'Inline Citation';

	get state() {
		return this._state;
	}

	set state(state) {
		this._state = state;
		this.button.classList.toggle(this.api.styles.inlineToolButtonActive, state);
	}
	constructor({ api }: { api: API }) {
		this._state = false;
		this.api = api;
		this.button = document.createElement('button');
	}

	render() {
		this.button.type = 'button';
		this.button.innerHTML = `
      <svg style="padding: 2px"  xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2c1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1m12 0c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1"/></svg>
  `;
		this.button.classList.add(this.api.styles.inlineToolButton);
		return this.button;
	}

	surround(range) {
		dispatchEvent(
			new CustomEvent('citation', {
				detail: { range, currentBlockIndex: this.api.blocks.getCurrentBlockIndex() }
			})
		);
	}

	checkState(selection) {}

	clear() {
		this.state = false;
	}
}
