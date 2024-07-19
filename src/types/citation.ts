// Define types for book and journal metadata
export interface BaseCitation {
	author: {
    first_name: string;
    last_name: string;
  };
	year: string;
	title: string;
}

export interface BookCitation extends BaseCitation {
	type: 'book';
	edition?: string;
	location: string;
	publisher: string;
}

export interface JournalCitation extends BaseCitation {
	type: 'journal';
	journal_title: string;
	volume: string;
	issue?: string;
	pages: string;
}

export type Citation = BookCitation | JournalCitation;

// validate the citation
export function validateCitationFields(citation: Citation): boolean {
  if (citation.type === 'book') {
    return (
      !!citation.author.first_name &&
      !!citation.author.last_name &&
      !!citation.year &&
      !!citation.title &&
      !!citation.location &&
      !!citation.publisher &&
      !!citation.edition
    );
  } else {
    return (
      !!citation.author.first_name &&
      !!citation.author.last_name &&
      !!citation.year &&
      !!citation.title &&
      !!citation.journal_title &&
      !!citation.volume &&
      !!citation.pages &&
      !!citation.issue
    );
  }
}