import type { Snippet } from 'svelte';

import type { Editor } from './Editor';

export type ComponentInputProps<T> = Partial<T> & {
  editor: Editor;
  class?: string;
  children?: Snippet;
};