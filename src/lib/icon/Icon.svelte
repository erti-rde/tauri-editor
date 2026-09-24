<script lang="ts">
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronLeft from '~icons/lucide/chevron-left';
	import ChevronRight from '~icons/lucide/chevron-right';
	import ChevronUp from '~icons/lucide/chevron-up';
	import DoubleChevronLeft from '~icons/lucide/chevrons-left';
	import DoubleChevronRight from '~icons/lucide/chevrons-right';
	import FilePlus from '~icons/lucide/file-Plus';
	import FileWarning from '~icons/lucide/file-warning';
	import Files from '~icons/lucide/files';
	import ListTree from '~icons/lucide/list-tree';
	import Pencil from '~icons/lucide/pencil';
	import Quote from '~icons/lucide/quote';
	import Trash from '~icons/lucide/trash-2';
	import ZoomIn from '~icons/lucide/zoom-in';
	import ZoomOut from '~icons/lucide/zoom-out';
	import Pdf from '~icons/ph/file-pdf-light';
	import X from '~icons/ph/x';

	import BookOpen from '~icons/lucide/book-open';
	import FilePen from '~icons/lucide/file-pen';
	import WindowClose from '~icons/mdi/close';
	import WindowMaximize from '~icons/mdi/window-maximize';
	import WindowMinimize from '~icons/mdi/window-minimize';

	import File from '~icons/lucide/file';
	import FileOutput from '~icons/lucide/file-output';
	import Folder from '~icons/lucide/folder';
	import FolderOpen from '~icons/lucide/folder-open';

	// The reader's chrome, on Zotero's model: a tool cluster, a page-layout
	// popup, and a way back to where a jump came from.
	import Highlighter from '~icons/lucide/highlighter';
	import Underline from '~icons/lucide/underline';
	import StickyNote from '~icons/lucide/sticky-note';
	import Crop from '~icons/lucide/crop';
	import PanelLeft from '~icons/lucide/panel-left';
	import GoBack from '~icons/lucide/corner-up-left';
	import FitWidth from '~icons/lucide/scan';
	import PageSetup from '~icons/lucide/type';
	import RotateLeft from '~icons/lucide/rotate-ccw';
	import RotateRight from '~icons/lucide/rotate-cw';
	import ScrollVertical from '~icons/lucide/gallery-vertical';
	import ScrollHorizontal from '~icons/lucide/gallery-horizontal';
	import ScrollWrapped from '~icons/lucide/grid-2x2';
	import SpreadNone from '~icons/lucide/square';
	import SpreadOdd from '~icons/lucide/book-open';
	import SpreadEven from '~icons/lucide/book';

	import ExternalLink from '~icons/lucide/external-link';
	import Settings from '~icons/lucide/settings';
	import Books from '~icons/mdi/bookshelf';
	import Search from '~icons/lucide/search';
	import Filter from '~icons/lucide/filter';
	import Edit from '~icons/lucide/edit';
	import Save from '~icons/lucide/save';
	import FileText from '~icons/lucide/file-text';
	import ScrollText from '~icons/lucide/scroll-text';
	import FileSpreadsheet from '~icons/lucide/file-spreadsheet';
	import Globe from '~icons/lucide/globe';
	import GraduationCap from '~icons/lucide/graduation-cap';
	import Presentation from '~icons/lucide/presentation';
	import Video from '~icons/lucide/video';
	import type { ClassValue } from 'svelte/elements';

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
		ExternalLink,
		Books,
		ListTree,
		Search,
		Filter,
		Edit,
		Save,
		FileText,
		ScrollText,
		FileSpreadsheet,
		Globe,
		GraduationCap,
		Presentation,
		Video,
		Highlighter,
		Underline,
		StickyNote,
		Crop,
		PanelLeft,
		GoBack,
		FitWidth,
		PageSetup,
		RotateLeft,
		RotateRight,
		ScrollVertical,
		ScrollHorizontal,
		ScrollWrapped,
		SpreadNone,
		SpreadOdd,
		SpreadEven
	};

	type Size = 's' | 'm' | 'l';
	type Icon = keyof typeof icons;

	interface Props {
		icon: Icon;
		size?: Size;
		class?: ClassValue;
	}

	let { icon, size = 'm', class: className }: Props = $props();

	const sizeMap = {
		s: 16,
		m: 24,
		l: 32
	};

	// Both derived, because both props change: the status footer swaps its icon
	// with the save state, and the toolbar swaps between editing and preview.
	// `const component = icons[icon]` read once at init, and wrapping that in
	// $derived only re-derived a value that could no longer change.
	const dimensions = $derived(sizeMap[size]);
	const SvelteComponent = $derived(icons[icon]);
</script>

<SvelteComponent style="width: {dimensions}px; height: {dimensions}px;" class={className} />
