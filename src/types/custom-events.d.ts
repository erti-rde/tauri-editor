interface SettingsUpdatedEvent extends CustomEvent {
	detail: {
		localeHasChanged: boolean;
		styleHasChanged: boolean;
		wordCountHasChanged: boolean;
	};
}

declare global {
	interface WindowEventMap {
		'settings-updated': SettingsUpdatedEvent;
	}
}

export {};
