<script lang="ts">
	import ChevronDown from '~icons/lucide/chevron-down';
	import FileWarning from '~icons/lucide/file-warning';
	import Files from '~icons/lucide/files';
	import Pencil from '~icons/lucide/pencil';
	import Quote from '~icons/lucide/quote';
	import Trash from '~icons/lucide/trash-2';
	import FilePlus from '~icons/lucide/file-Plus';
	import Pdf from '~icons/ph/file-pdf-light';
	import X from '~icons/ph/x';
  import DoubleChevronLeft from '~icons/lucide/chevrons-left'
  import DoubleChevronRight from '~icons/lucide/chevrons-right'

	import WindowMinimize from '~icons/mdi/window-minimize';
	import WindowMaximize from '~icons/mdi/window-maximize';
	import WindowClose from '~icons/mdi/close';
  import BookOpen from "~icons/lucide/book-open";
  import FilePen from "~icons/lucide/file-pen"

  import Folder from "~icons/lucide/folder"
  import File from  "~icons/lucide/file"

	const icons = {
		ChevronDown,
		FileWarning,
		Files,
		Pdf,
		Pencil,
		Quote,
		Trash,
		X,
		FilePlus,
		WindowMinimize,
		WindowMaximize,
		WindowClose,
    DoubleChevronLeft,
    DoubleChevronRight,
    BookOpen,
    FilePen,
    Folder,
    File
	};

	type Size = 's' | 'm' | 'l';
	type Icon = keyof typeof icons;

	export let icon: Icon;
	export let size: Size = 'm';

	const sizeMap = {
		s: 16,
		m: 24,
		l: 32
	};

	const dimensions = sizeMap[size];
	const component = icons[icon];
</script>

<svelte:component this={component} style="width: {dimensions}px; height: {dimensions}px;" />
