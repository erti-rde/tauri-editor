import type { BlockTool } from '@editorjs/editorjs';

export class Bibliography implements BlockTool {
	save(block: HTMLElement) {
		// console.log(block);
	}
	render(): HTMLElement {
		const div = document.createElement('div');
		div.classList.add('bibliography-wrapper');

		return div;
	}
}
