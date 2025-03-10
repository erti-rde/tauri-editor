<script lang="ts">
	import ChevronUp from '~icons/lucide/chevron-up';
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronLeft from '~icons/lucide/chevron-left';
	import ChevronRight from '~icons/lucide/chevron-right';
	import ZoomIn from '~icons/lucide/zoom-in';
	import ZoomOut from '~icons/lucide/zoom-out';
	import FileWarning from '~icons/lucide/file-warning';
	import Files from '~icons/lucide/files';
	import Pencil from '~icons/lucide/pencil';
	import Quote from '~icons/lucide/quote';
	import Trash from '~icons/lucide/trash-2';
	import FilePlus from '~icons/lucide/file-Plus';
	import Pdf from '~icons/ph/file-pdf-light';
	import X from '~icons/ph/x';
	import DoubleChevronLeft from '~icons/lucide/chevrons-left';
	import DoubleChevronRight from '~icons/lucide/chevrons-right';

	import WindowMinimize from '~icons/mdi/window-minimize';
	import WindowMaximize from '~icons/mdi/window-maximize';
	import WindowClose from '~icons/mdi/close';
	import BookOpen from '~icons/lucide/book-open';
	import FilePen from '~icons/lucide/file-pen';

	import Folder from '~icons/lucide/folder';
	import FolderOpen from '~icons/lucide/folder-open';
	import File from '~icons/lucide/file';
	import FileOutput from '~icons/lucide/file-output';

	import Settings from '~icons/lucide/settings';
	import ExternalLink from '~icons/lucide/external-link';

	const icons = {
		ChevronUp,
		ChevronDown,
		ChevronLeft,
		ChevronRight,
		ZoomIn,
		ZoomOut,
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
		File,
		FolderOpen,
		FileOutput,
		Settings,
		ExternalLink
	};

	type Size = 's' | 'm' | 'l';
	type Icon = keyof typeof icons;

	interface Props {
		icon: Icon;
		size?: Size;
	}

	let { icon, size = 'm' }: Props = $props();

	const sizeMap = {
		s: 16,
		m: 24,
		l: 32
	};

	const dimensions = sizeMap[size];
	const component = icons[icon];

	const SvelteComponent = $derived(component);
</script>

<SvelteComponent style="width: {dimensions}px; height: {dimensions}px;" />
