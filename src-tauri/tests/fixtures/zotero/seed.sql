-- Invented rows for tests/zotero.rs, over the Zotero 10 tables in schema.sql.
-- Keys are Zotero-shaped: eight of A–Z and 2–9.
--
-- My Library
--   Methods            PAPERAA2 (PDF), PAPEREE5 (in the bin), a note, a web page
--   Thesis             PAPERCC3 (PDF under Zotero's base folder)
--     Chapter 2        PAPERBB2 (no PDF)
--   Binned             (in the bin)
--     Under binned     PAPERFF6 (so unfiled, as far as Erti shows)
--   unfiled            PAPERDD4 (PDF never downloaded), STANDPD7 (a PDF on its own)
-- Lab reading (group 4242)
--   Group papers       GROUPPA2 (a linked PDF, its path set by the test)

INSERT INTO version (schema, version) VALUES ('userdata', 130);

INSERT INTO libraries (libraryID, type, editable, filesEditable) VALUES
    (1, 'user', 1, 1),
    (2, 'group', 1, 1),
    (3, 'feed', 1, 1);
INSERT INTO groups (groupID, libraryID, name, description, version) VALUES
    (4242, 2, 'Lab reading', '', 0);

INSERT INTO itemTypesCombined (itemTypeID, typeName, custom) VALUES
    (1, 'note', 0), (2, 'annotation', 0), (3, 'attachment', 0),
    (4, 'journalArticle', 0), (5, 'book', 0), (6, 'bookSection', 0);

INSERT INTO fieldsCombined (fieldID, fieldName, custom) VALUES
    (1, 'title', 0), (2, 'date', 0), (3, 'publicationTitle', 0), (4, 'bookTitle', 0),
    (5, 'DOI', 0), (6, 'volume', 0), (7, 'pages', 0), (8, 'publisher', 0);
INSERT INTO baseFieldMappingsCombined (itemTypeID, baseFieldID, fieldID) VALUES (6, 3, 4);

INSERT INTO creatorTypes (creatorTypeID, creatorType) VALUES (1, 'author'), (2, 'editor');
INSERT INTO creators (creatorID, firstName, lastName, fieldMode) VALUES
    (1, 'Ada', 'Lovelace', 0),
    (2, 'Alan', 'Turing', 0),
    (3, '', 'World Health Organization', 1),
    (4, 'Grace', 'Hopper', 0);

INSERT INTO collections (collectionID, collectionName, parentCollectionID, libraryID, key) VALUES
    (10, 'Methods', NULL, 1, 'METHODS2'),
    (11, 'Thesis', NULL, 1, 'THESIS22'),
    (12, 'Chapter 2', 11, 1, 'CHAPTER2'),
    (13, 'Binned', NULL, 1, 'BINNED33'),
    (14, 'Under binned', 13, 1, 'UNDERBN4'),
    (20, 'Group papers', NULL, 2, 'GROUPC55');
-- Zotero puts a collection's subcollections in the bin with it.
INSERT INTO deletedCollections (collectionID) VALUES (13), (14);

INSERT INTO items (itemID, itemTypeID, libraryID, key) VALUES
    (100, 4, 1, 'PAPERAA2'),
    (101, 5, 1, 'PAPERBB2'),
    (102, 6, 1, 'PAPERCC3'),
    (103, 4, 1, 'PAPERDD4'),
    (104, 4, 1, 'PAPEREE5'),
    (105, 4, 1, 'PAPERFF6'),
    (106, 3, 1, 'STANDPD7'),
    (107, 1, 1, 'NOTEXXX8'),
    (108, 3, 1, 'HTMLSNP9'),
    (109, 4, 2, 'GROUPPA2'),
    (200, 3, 1, 'ATTACHA2'),
    (201, 3, 1, 'ATTACHC3'),
    (202, 3, 1, 'ATTACHD4'),
    (203, 3, 2, 'GROUPAT2'),
    (204, 3, 1, 'ATTACHE5');

INSERT INTO itemAttachments (itemID, parentItemID, linkMode, contentType, path) VALUES
    (200, 100, 0, 'application/pdf', 'storage:trust.pdf'),
    (201, 102, 2, 'application/pdf', 'attachments:papers/handbook.pdf'),
    (202, 103, 1, 'application/pdf', 'storage:never-downloaded.pdf'),
    (106, NULL, 0, 'application/pdf', 'storage:scanned chapter.pdf'),
    (108, NULL, 3, 'text/html', NULL),
    (203, 109, 2, 'application/pdf', 'SET BY THE TEST'),
    (204, 104, 0, 'application/pdf', 'storage:binned.pdf');
INSERT INTO itemNotes (itemID, parentItemID, note, title) VALUES (107, NULL, '<p>A note</p>', 'A note');

INSERT INTO deletedItems (itemID) VALUES (104);

INSERT INTO collectionItems (collectionID, itemID, orderIndex) VALUES
    (10, 100, 0), (10, 104, 1), (10, 107, 2), (10, 108, 3),
    (11, 102, 0),
    (12, 101, 0),
    (14, 105, 0),
    (20, 109, 0);

INSERT INTO itemDataValues (valueID, value) VALUES
    (1, 'Trust in institutions'),
    (2, '2020-03-00 March 2020'),
    (3, 'Journal of Trust'),
    (4, '10.5555/trust'),
    (5, 'On computable numbers'),
    (6, '1936-00-00 1936'),
    (7, 'A chapter'),
    (8, 'The Handbook'),
    (9, 'Never downloaded'),
    (10, 'In the bin'),
    (11, 'Under a binned collection'),
    (12, 'Scanned chapter'),
    (13, 'A group paper'),
    (14, '12'),
    (15, '1-20');

INSERT INTO itemData (itemID, fieldID, valueID) VALUES
    (100, 1, 1), (100, 2, 2), (100, 3, 3), (100, 5, 4), (100, 6, 14), (100, 7, 15),
    (101, 1, 5), (101, 2, 6),
    (102, 1, 7), (102, 4, 8),
    (103, 1, 9),
    (104, 1, 10),
    (105, 1, 11),
    (106, 1, 12),
    (109, 1, 13);

INSERT INTO itemCreators (itemID, creatorID, creatorTypeID, orderIndex) VALUES
    (100, 1, 1, 0), (100, 2, 1, 1),
    (101, 3, 1, 0),
    (102, 4, 1, 0), (102, 2, 2, 1);
