import type { Citation, BaseCitation, BookCitation, JournalCitation } from '$types/citation';

// Function to generate citation based on the type
export function generateHarvardCitation(metadata: Citation): string {
	if (metadata.type === 'book') {
		return formatBookCitation(metadata);
	} else if (metadata.type === 'journal') {
		return formatJournalCitation(metadata);
	} else {
		return 'Unsupported source type';
	}
}

// New function to generate in-text citation
export function generateHarvardInTextCitation(metadata: BaseCitation, page?: string): string {
	let citation = `${metadata.author.last_name, metadata.author.first_name} (${metadata.year})`;
	if (page) {
		citation += `, p.${page}`;
	}
	return citation;
}

// Function to format book citation
function formatBookCitation(book: BookCitation): string {
	const { author, year, title, edition, location, publisher } = book;
	let citation = `${author.last_name} (${year}) ${title}, `;
	if (edition && edition.toLowerCase() !== 'first') {
		citation += `${edition} ed., `;
	}
	citation += `${location}: ${publisher}.`;
	return citation;
}

// Function to format journal citation
function formatJournalCitation(article: JournalCitation): string {
	const { author, year, title, journal_title, volume, issue, pages } = article;
	let citation = `${author.last_name} (${year}) '${title}', ${journal_title}`;
	if (volume) citation += `, vol. ${volume}`;
	if (issue) citation += `, no. ${issue}`;
	citation += `, pp. ${pages}.`;
	return citation;
}
