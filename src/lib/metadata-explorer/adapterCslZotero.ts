import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';

interface OriginalZoteroField {
	field: string;
	baseField?: string;
}

interface OriginalZoteroCreatorType {
	creatorType: string;
	primary?: boolean;
}

interface OriginalZoteroItemType {
	itemType: string;
	fields: OriginalZoteroField[];
	creatorTypes: OriginalZoteroCreatorType[];
}

interface OriginalZoteroSchema {
	version: number;
	itemTypes: OriginalZoteroItemType[];
	meta?: object;
	csl: {
		types: { [cslType: string]: string[] };
		fields: {
			text: { [cslField: string]: string[] };
			date: { [cslField: string]: string };
		};
		names: { [zoteroCreator: string]: string };
	};
}

// Augmented interfaces for the output schema
export interface AugmentedZoteroField extends OriginalZoteroField {
	inputType?: string;
	cslField?: string; // The chosen CSL field for this Zotero field in this itemType context
	label: string; // Human-readable label
}

export interface AugmentedZoteroCreatorType extends OriginalZoteroCreatorType {
	cslVariable?: string; // Corresponding CSL name variable
	label: string; // Human-readable label (e.g., "Author", "Editor")
}

export interface AugmentedZoteroItemType {
	itemType: string; // Zotero item type name
	cslType?: string; // Corresponding CSL type name (best guess)
	label: string; // Human-readable label for the item type (e.g., "Journal Article")
	fields: AugmentedZoteroField[]; // Augmented fields
	creatorTypes: AugmentedZoteroCreatorType[]; // Augmented creator types
}

// The final output schema structure
export interface AugmentedZoteroSchema {
	itemTypes: AugmentedZoteroItemType[]; // The main array of augmented types
	typeFields: { value: string; label: string }[]; // Array of item types
	zoteroToCslTypeMap: Map<string, string>;
	cslToZoteroTypeMap: Map<string, string>;
}

// Build map from Zotero field name to potential CSL fields
function buildReverseFieldMap(schema: OriginalZoteroSchema): Map<string, string[]> {
	const map = new Map<string, string[]>();
	// Process text fields
	for (const [cslField, zoteroFields] of Object.entries(schema.csl.fields.text)) {
		for (const zoteroField of zoteroFields) {
			const list = map.get(zoteroField) || [];
			if (!list.includes(cslField)) list.push(cslField);
			map.set(zoteroField, list);
		}
	}
	// Process date fields
	for (const [cslField, zoteroField] of Object.entries(schema.csl.fields.date)) {
		const list = map.get(zoteroField) || [];
		if (!list.includes(cslField)) list.push(cslField);
		map.set(zoteroField, list);
	}
	return map;
}

// Choose single best CSL field based on context (Heuristic - same logic as before)
function chooseCslField(
	zoteroField: string,
	itemType: string,
	potentialCslFields: string[]
): string | undefined {
	if (!potentialCslFields || potentialCslFields.length === 0) return undefined;
	if (potentialCslFields.length === 1) return potentialCslFields[0];

	// --- Apply Heuristics ---

	// <<< NEW RULE for shortTitle >>>
	if (zoteroField === 'shortTitle') {
		if (potentialCslFields.includes('title-short')) return 'title-short'; // Prioritize CSL 'title-short'
		if (potentialCslFields.includes('shortTitle')) return 'shortTitle'; // Fallback to CSL 'shortTitle' if 'title-short' isn't listed (unlikely)
	}
	// <<< END NEW RULE >>>

	// (Existing rules for place, date, number, type, medium...)
	if (zoteroField === 'place' || zoteroField === 'repositoryLocation') {
		const eventTypes = ['presentation', 'conferencePaper', 'hearing'];
		if (eventTypes.includes(itemType) && potentialCslFields.includes('event-place'))
			return 'event-place';
		if (potentialCslFields.includes('publisher-place')) return 'publisher-place';
	}
	// ... rest of the existing heuristics ...
	if (zoteroField === 'accessDate' && potentialCslFields.includes('accessed')) return 'accessed';
	if (zoteroField === 'filingDate' && potentialCslFields.includes('submitted')) return 'submitted';
	if (
		['date', 'dateDecided', 'issueDate', 'dateEnacted'].includes(zoteroField) &&
		potentialCslFields.includes('issued')
	)
		return 'issued';
	const numberLikeFields = [
		'billNumber',
		'docketNumber',
		'documentNumber',
		'episodeNumber',
		'patentNumber',
		'reportNumber',
		'publicLawNumber',
		'archiveID',
		'identifier'
	];
	if (zoteroField === 'number' && itemType === 'standard' && potentialCslFields.includes('number'))
		return 'number';
	if (numberLikeFields.includes(zoteroField) && potentialCslFields.includes('number'))
		return 'number';
	if (zoteroField === 'issue' && potentialCslFields.includes('issue')) return 'issue';
	if (zoteroField === 'volume' && potentialCslFields.includes('volume')) return 'volume';
	if (
		['codeVolume', 'reporterVolume', 'codeNumber'].includes(zoteroField) &&
		potentialCslFields.includes('volume')
	)
		return 'volume';
	if (
		['pages', 'codePages', 'firstPage'].includes(zoteroField) &&
		potentialCslFields.includes('page')
	)
		return 'page';
	if (zoteroField === 'session' && potentialCslFields.includes('chapter-number'))
		return 'chapter-number';
	const typeFields = [
		'websiteType',
		'letterType',
		'manuscriptType',
		'mapType',
		'presentationType',
		'reportType',
		'thesisType',
		'genre',
		'type'
	];
	if (
		typeFields.includes(zoteroField) ||
		(zoteroField === 'type' && ['dataset', 'standard'].includes(itemType))
	) {
		if (potentialCslFields.includes('genre')) return 'genre';
	}
	const mediumFields = [
		'artworkMedium',
		'audioRecordingFormat',
		'interviewMedium',
		'videoRecordingFormat',
		'system',
		'audioFileType',
		'format'
	];
	if (mediumFields.includes(zoteroField) && potentialCslFields.includes('medium')) return 'medium';

	// --- Fallback for unresolved ambiguity ---
	// console.warn(`Ambiguity unresolved for field '${zoteroField}' on itemType '${itemType}'. Potentials: ${potentialCslFields.join(', ')}`);
	return undefined; // Keep returning undefined if no specific rule matches ambiguity
}

// Build map from Zotero Type to CSL Type
function buildZoteroToCslTypeMap(schema: OriginalZoteroSchema): Map<string, string> {
	const map = new Map<string, string>();
	for (const [cslType, zoteroTypes] of Object.entries(schema.csl.types)) {
		for (const zoteroType of zoteroTypes) {
			if (!map.has(zoteroType)) map.set(zoteroType, cslType);
		}
	}
	return map;
}

function buildCslToZoteroTypeMap(schema: OriginalZoteroSchema): Map<string, string> {
  const map = new Map<string, string>();
  for (const [cslType, zoteroType] of Object.entries(schema.csl.types)) {
    if (zoteroType.length == 1) {
      // Add the original mapping
      map.set(cslType, zoteroType[0]);
      
      // Handle reversed hyphenated types
      if (cslType.includes('-')) {
        const parts = cslType.split('-');
        const reversedType = `${parts[1]}-${parts[0]}`;
        map.set(reversedType, zoteroType[0]);
      }
    }
  }
  
  return map;
}

function formatFieldName(fieldName: string): string {
	const result = fieldName.replace(/([A-Z])/g, ' $1');
	return result.charAt(0).toUpperCase() + result.slice(1);
}

function getInputType(fieldName: string): string {
	const numberTypes = [
		'chapter-number',
		'citation-number',
		'collection-number',
		'edition',
		'first-reference-note-number',
		'issue',
		'locator',
		'number',
		'number-of-pages',
		'number-of-volumes',

		'part-number',
		'printing-number',
		'section',
		'supplement-number',
		'version',
		'volume'
	];
	const dateTypes = [
		'accessed',
		'available-date',
		'event-date',
		'issued',
		'original-date',
		'submitted'
	];

	const rangeTypes = ['page', 'page-first'];

	if (numberTypes.includes(fieldName)) {
		return 'number';
	} else if (dateTypes.includes(fieldName)) {
		return 'date';
	} else if (rangeTypes.includes(fieldName)) {
		return 'text';
	} else {
		return 'text';
	}
}

export async function augmentSchema(): Promise<AugmentedZoteroSchema> {
	// Schema was fetched from https://api.zotero.org/schema
	// current version 33
	const schemaJson = await readTextFile('resources/csl/schema.json', {
		baseDir: BaseDirectory.Resource
	});
	const schema: OriginalZoteroSchema = JSON.parse(schemaJson);

	const reverseFieldMap = buildReverseFieldMap(schema);
	const reverseCreatorMap = new Map<string, string>(Object.entries(schema.csl.names)); // Zotero Creator -> CSL Variable
	const zoteroToCslTypeMap = buildZoteroToCslTypeMap(schema);
	const cslToZoteroTypeMap = buildCslToZoteroTypeMap(schema);
	const augmentedItemTypes: AugmentedZoteroItemType[] = [];

	// Process each item type definition
	for (const itemTypeDef of schema.itemTypes) {
		const itemTypeName = itemTypeDef.itemType;
		const cslType = zoteroToCslTypeMap.get(itemTypeName);
		const itemLabel = formatFieldName(itemTypeName);

		// Augment fields for this item type
		const augmentedFields: AugmentedZoteroField[] = itemTypeDef.fields.map((fieldDef) => {
			const fieldName = fieldDef.field;
			const potentialCslFields = reverseFieldMap.get(fieldName) || [];
			const chosenCslField = chooseCslField(fieldName, itemTypeName, potentialCslFields);
			const fieldLabel = formatFieldName(fieldName);
			const inputType = chosenCslField && getInputType(chosenCslField);

			return {
				...fieldDef, // field, baseField?
				cslField: chosenCslField,
				label: fieldLabel,
				inputType
			};
		});

		// Augment creator types for this item type
		const augmentedCreatorTypes: AugmentedZoteroCreatorType[] = itemTypeDef.creatorTypes.map(
			(creatorDef) => {
				const creatorTypeName = creatorDef.creatorType;
				const cslVariable = reverseCreatorMap.get(creatorTypeName);
				const creatorLabel = formatFieldName(creatorTypeName);

				return {
					...creatorDef, // creatorType, primary?
					cslVariable: cslVariable,
					label: creatorLabel
				};
			}
		);

		// Create the augmented item type definition
		const augmentedItem: AugmentedZoteroItemType = {
			itemType: itemTypeName,
			cslType: cslType,
			label: itemLabel,
			fields: augmentedFields,
			creatorTypes: augmentedCreatorTypes
		};

		augmentedItemTypes.push(augmentedItem);
	}

	// Construct the final augmented schema object
	const finalAugmentedSchema: AugmentedZoteroSchema = {
		// version: schema.version,
		zoteroToCslTypeMap,
		cslToZoteroTypeMap,
		itemTypes: augmentedItemTypes, // Keep the array structure
		typeFields: augmentedItemTypes
			.map((item) => {
				if (item.cslType) {
					return { value: item.itemType, label: formatFieldName(item.itemType) };
				}
			})
			.filter((field) => field) as Array<{ value: string; label: string }>
	};
	return finalAugmentedSchema;
}
