// The version this build is, as package.json says: the one Tauri and Cargo
// are checked against at release (scripts/release). Only `version` is
// bundled, not the rest of the file.
import { version } from '../../package.json';

export const APP_VERSION: string = version;
