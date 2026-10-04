/**
 * The primitives (ADR 010, docs/design-system.md). A component builds from
 * these and the tokens; a missing one is added here, with a catalogue entry.
 */
export { default as Banner } from './Banner.svelte';
export { default as Button } from './Button.svelte';
export { default as Checkbox } from './Checkbox.svelte';
export { default as ConfirmDialog } from './ConfirmDialog.svelte';
export { default as DateField } from './DateField.svelte';
export { default as Dialog } from './Dialog.svelte';
export { default as EmptyState } from './EmptyState.svelte';
export { default as IconButton } from './IconButton.svelte';
export { default as Menu, type MenuItem } from './Menu.svelte';
export { default as Panel } from './Panel.svelte';
export { default as PanelHeader } from './PanelHeader.svelte';
export { default as Popover } from './Popover.svelte';
export { default as ProgressLine } from './ProgressLine.svelte';
export { default as RadioGroup } from './RadioGroup.svelte';
export { default as SearchField } from './SearchField.svelte';
export { default as Select } from './Select.svelte';
export { default as Sidebar } from './Sidebar.svelte';
export { default as Switch } from './Switch.svelte';
export { default as Tabs } from './Tabs.svelte';
export { default as TextArea } from './TextArea.svelte';
export { default as TextField } from './TextField.svelte';
export { default as Tooltip } from './Tooltip.svelte';
// Existing, aligned to the tokens, and kept where the app already imports them.
export { default as Loader } from '$lib/loader/Loader.svelte';
export { default as Toast } from '$lib/toast/Toast.svelte';
export type { IconComponent } from './icon';
