//! A project from Zotero (M1b-11, ADR 012): Erti reads a copy of Zotero's
//! database, shows its tree, reads what was ticked, attaches PDFs where Zotero
//! keeps them, and syncs what the project follows.
//!
//! The database is built from `fixtures/zotero/schema.sql`, the tables as
//! Zotero 10 makes them, and `seed.sql`, whose header draws the library.

use std::path::{Path, PathBuf};

use erti_lib::db::DbState;
use erti_lib::db_commands::{create_project_in, import_sources_in, ImportedSource};
use erti_lib::ipc::ErrorKind;
use erti_lib::zotero::{
    self, read, zotero_attach_in, zotero_follow_in, zotero_items_in, zotero_link_in,
    zotero_read_in, zotero_record_in, zotero_status_in, zotero_sync_plan_in, zotero_tree_in, Env,
    ZoteroAttach, ZoteroItem, ZoteroPick, ZoteroRecord,
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};

const SCHEMA: &str = include_str!("fixtures/zotero/schema.sql");
const SEED: &str = include_str!("fixtures/zotero/seed.sql");

struct World {
    state: DbState,
    env: Env,
    /// `<home>/Zotero`, where Erti looks first.
    data: PathBuf,
    root: PathBuf,
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-zotero-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

async fn zotero_db(path: &Path) -> SqlitePool {
    SqlitePool::connect_with(
        SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            // `itemAttachments` refers to Zotero's `charsets`, which Erti
            // doesn't read and the fixture leaves out.
            .foreign_keys(false),
    )
    .await
    .unwrap()
}

fn pdf(path: &Path, body: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, format!("%PDF-1.4\n% {body}\n")).unwrap();
}

/// A library, a project, and a Zotero data folder at `<home>/Zotero`.
async fn world(name: &str) -> World {
    let root = scratch(name);
    let home = root.join("home");
    let data = home.join("Zotero");
    std::fs::create_dir_all(&data).unwrap();

    let db = zotero_db(&data.join("zotero.sqlite")).await;
    sqlx::raw_sql(SCHEMA).execute(&db).await.unwrap();
    sqlx::raw_sql(SEED).execute(&db).await.unwrap();
    let linked = root.join("linked").join("group paper.pdf");
    pdf(&linked, "group");
    sqlx::query("UPDATE itemAttachments SET path = ? WHERE itemID = 203")
        .bind(linked.to_string_lossy().to_string())
        .execute(&db)
        .await
        .unwrap();
    db.close().await;
    pdf(&data.join("storage/ATTACHA2/trust.pdf"), "trust");
    pdf(
        &data.join("storage/STANDPD7/scanned chapter.pdf"),
        "scanned",
    );
    pdf(&data.join("storage/ATTACHE5/binned.pdf"), "binned");

    let state = DbState::default();
    state.open_library(&root.join("library.db")).await.unwrap();
    state.open_project(&root.join("project")).await.unwrap();
    World {
        state,
        env: Env {
            home: Some(home),
            cache: root.join("cache"),
        },
        data: data.canonicalize().unwrap(),
        root,
    }
}

async fn linked(name: &str) -> World {
    let w = world(name).await;
    zotero_link_in(&w.state, &w.env, None).await.unwrap();
    w
}

fn pick(library: &str, kind: &str, key: Option<&str>) -> ZoteroPick {
    ZoteroPick {
        library: library.into(),
        kind: kind.into(),
        key: key.map(Into::into),
        name: None,
    }
}

fn keys(items: &[ZoteroItem]) -> Vec<&str> {
    items.iter().map(|i| i.key.as_str()).collect()
}

fn work(n: usize) -> String {
    format!("erti:00000000-0000-4000-8000-{n:012x}")
}

/// Import works for these Zotero papers, as the webview does, and record them.
async fn imported(w: &World, papers: &[(&str, usize)]) {
    let sources = papers
        .iter()
        .map(|(key, n)| ImportedSource {
            id: work(*n),
            csl_json: serde_json::json!({ "type": "article-journal", "title": key }).to_string(),
            zotero_type: "journalArticle".into(),
        })
        .collect();
    import_sources_in(&w.state, sources, true).await.unwrap();
    let records = papers
        .iter()
        .map(|(key, n)| ZoteroRecord {
            library: "user".into(),
            key: (*key).into(),
            work: work(*n),
        })
        .collect();
    zotero_record_in(&w.state, records).await.unwrap();
}

// M1b-11 AC-2
#[tokio::test]
async fn zotero_is_found_where_it_keeps_its_library_by_default() {
    let w = world("found").await;

    let status = zotero_status_in(&w.state, &w.env).await.unwrap();
    assert_eq!(status.linked, None);
    assert_eq!(status.detected.as_deref(), Some(&*w.data.to_string_lossy()));

    // Nothing is read until it's linked.
    let refused = zotero_tree_in(&w.state, &w.env).await.unwrap_err();
    assert_eq!(refused.kind, ErrorKind::NotFound);

    let status = zotero_link_in(&w.state, &w.env, None).await.unwrap();
    assert_eq!(status.linked.as_deref(), Some(&*w.data.to_string_lossy()));
    assert!(zotero_tree_in(&w.state, &w.env).await.is_ok());
}

// M1b-11 AC-2
#[tokio::test]
async fn a_folder_is_linked_only_once_the_user_has_picked_it() {
    let w = world("picked").await;
    let elsewhere = w.root.join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    std::fs::copy(
        w.data.join("zotero.sqlite"),
        elsewhere.join("zotero.sqlite"),
    )
    .unwrap();
    let path = elsewhere.to_string_lossy().to_string();

    let refused = zotero_link_in(&w.state, &w.env, Some(path.clone()))
        .await
        .unwrap_err();
    assert_eq!(refused.kind, ErrorKind::PermissionDenied);

    // The project folder isn't a pick: a script can write there (T3).
    let project = w.state.project_root().await.unwrap();
    std::fs::copy(w.data.join("zotero.sqlite"), project.join("zotero.sqlite")).unwrap();
    let refused = zotero_link_in(&w.state, &w.env, Some(project.to_string_lossy().into()))
        .await
        .unwrap_err();
    assert_eq!(refused.kind, ErrorKind::PermissionDenied);

    w.state.grants.grant(&elsewhere);
    let status = zotero_link_in(&w.state, &w.env, Some(path)).await.unwrap();
    assert_eq!(
        status.linked.as_deref(),
        Some(&*elsewhere.to_string_lossy())
    );

    let empty = w.root.join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    w.state.grants.grant(&empty);
    let refused = zotero_link_in(&w.state, &w.env, Some(empty.to_string_lossy().into()))
        .await
        .unwrap_err();
    assert_eq!(refused.kind, ErrorKind::InvalidInput);
}

// M1b-11 AC-2
#[tokio::test]
async fn without_zotero_erti_says_it_found_none() {
    let w = world("none").await;
    let env = Env {
        home: Some(w.root.join("nobody")),
        cache: w.env.cache.clone(),
    };
    let status = zotero_status_in(&w.state, &env).await.unwrap();
    assert_eq!(status.detected, None);
    let refused = zotero_link_in(&w.state, &env, None).await.unwrap_err();
    assert_eq!(refused.kind, ErrorKind::NotFound);
    assert_eq!(refused.message, zotero::NOT_FOUND);
}

// M1b-11 AC-3
#[tokio::test]
async fn the_tree_is_zoteros_libraries_and_collections_without_the_bin() {
    let w = linked("tree").await;
    let tree = zotero_tree_in(&w.state, &w.env).await.unwrap();

    let names: Vec<_> = tree
        .iter()
        .map(|l| (l.id.as_str(), l.name.as_str()))
        .collect();
    // Feeds aren't libraries of papers.
    assert_eq!(
        names,
        [("user", "My Library"), ("group:4242", "Lab reading")]
    );

    let mine = &tree[0];
    let top: Vec<_> = mine
        .collections
        .iter()
        .map(|c| (c.name.as_str(), c.papers))
        .collect();
    // Methods holds one paper: the one in the bin, the note and the web page
    // aren't papers.
    assert_eq!(top, [("Methods", 1), ("Thesis", 1)]);
    let thesis = &mine.collections[1];
    assert_eq!(thesis.children.len(), 1);
    assert_eq!(thesis.children[0].name, "Chapter 2");
    assert_eq!(thesis.children[0].key, "CHAPTER2");

    // Unfiled: the paper whose PDF wasn't downloaded, the PDF on its own, and
    // the paper whose only collection is in the bin, which would otherwise be
    // out of reach.
    assert_eq!(mine.unfiled, 3);
    assert_eq!(mine.papers, 6);
    assert_eq!(tree[1].collections[0].name, "Group papers");
}

// M1b-11 AC-3
#[tokio::test]
async fn a_collections_papers_load_when_it_opens() {
    let w = linked("items").await;

    let methods = zotero_items_in(&w.state, &w.env, "user", Some("METHODS2"))
        .await
        .unwrap();
    assert_eq!(methods.len(), 1);
    assert_eq!(methods[0].title, "Trust in institutions");
    assert_eq!(methods[0].creators, "Lovelace & Turing");
    assert_eq!(methods[0].year.as_deref(), Some("2020"));
    assert_eq!(methods[0].pdfs, 1);

    let unfiled = zotero_items_in(&w.state, &w.env, "user", None)
        .await
        .unwrap();
    let titles: Vec<_> = unfiled.iter().map(|p| p.title.as_str()).collect();
    assert_eq!(
        titles,
        [
            "Never downloaded",
            "Scanned chapter",
            "Under a binned collection"
        ]
    );

    let chapter = zotero_items_in(&w.state, &w.env, "user", Some("CHAPTER2"))
        .await
        .unwrap();
    assert_eq!(chapter[0].creators, "World Health Organization");

    let refused = zotero_items_in(&w.state, &w.env, "user", Some("../etc"))
        .await
        .unwrap_err();
    assert_eq!(refused.kind, ErrorKind::InvalidInput);
}

// M1b-11 AC-4
#[tokio::test]
async fn a_collection_brings_everything_under_it_each_paper_once() {
    let w = linked("read").await;
    let items = zotero_read_in(
        &w.state,
        &w.env,
        &[
            pick("user", "collection", Some("THESIS22")),
            pick("user", "item", Some("PAPERBB2")),
            pick("group:4242", "collection", Some("GROUPC55")),
        ],
    )
    .await
    .unwrap();
    let mut got = keys(&items);
    got.sort();
    assert_eq!(got, ["GROUPPA2", "PAPERBB2", "PAPERCC3"]);
    let item = |key: &str| items.iter().find(|i| i.key == key).unwrap();
    assert_eq!(item("GROUPPA2").library, "group:4242");

    let chapter = item("PAPERCC3");
    assert_eq!(chapter.item_type, "bookSection");
    // A type's own field comes with the base Zotero's CSL map is written in.
    let book_title = chapter
        .fields
        .iter()
        .find(|f| f.name == "bookTitle")
        .unwrap();
    assert_eq!(book_title.base.as_deref(), Some("publicationTitle"));
    assert_eq!(book_title.value, "The Handbook");
    let roles: Vec<_> = chapter
        .creators
        .iter()
        .map(|c| (c.creator_type.as_str(), c.last_name.as_str()))
        .collect();
    assert_eq!(roles, [("author", "Hopper"), ("editor", "Turing")]);

    let who = &item("PAPERBB2").creators[0];
    assert!(who.single);
    assert_eq!(who.last_name, "World Health Organization");
}

// M1b-11 AC-4
#[tokio::test]
async fn a_whole_library_is_its_papers_and_nothing_in_the_bin() {
    let w = linked("whole").await;
    let items = zotero_read_in(&w.state, &w.env, &[pick("user", "library", None)])
        .await
        .unwrap();
    let mut got = keys(&items);
    got.sort();
    assert_eq!(
        got,
        ["PAPERAA2", "PAPERBB2", "PAPERCC3", "PAPERDD4", "PAPERFF6", "STANDPD7"]
    );

    let unfiled = zotero_read_in(&w.state, &w.env, &[pick("user", "unfiled", None)])
        .await
        .unwrap();
    let mut got = keys(&unfiled);
    got.sort();
    assert_eq!(got, ["PAPERDD4", "PAPERFF6", "STANDPD7"]);
}

// M1b-11 AC-5
#[tokio::test]
async fn each_pdf_says_whether_it_can_be_attached_and_why_not() {
    let w = linked("reasons").await;
    let items = zotero_read_in(&w.state, &w.env, &[pick("user", "library", None)])
        .await
        .unwrap();
    let reason = |key: &str| {
        let item = items.iter().find(|i| i.key == key).unwrap();
        item.pdfs
            .iter()
            .map(|p| (p.file_name.clone(), p.reason.clone()))
            .collect::<Vec<_>>()
    };
    assert_eq!(reason("PAPERAA2"), [("trust.pdf".to_string(), None)]);
    assert_eq!(
        reason("PAPERCC3"),
        [(
            "handbook.pdf".to_string(),
            Some(read::IN_BASE_FOLDER.to_string())
        )]
    );
    assert_eq!(
        reason("PAPERDD4"),
        [(
            "never-downloaded.pdf".to_string(),
            Some(read::NOT_DOWNLOADED.to_string())
        )]
    );
    // A PDF on its own is its own paper's file.
    assert_eq!(
        reason("STANDPD7"),
        [("scanned chapter.pdf".to_string(), None)]
    );
    assert!(reason("PAPERBB2").is_empty());
}

// M1b-11 AC-6
#[tokio::test]
async fn pdfs_are_attached_where_zotero_keeps_them_and_open_again_later() {
    let w = linked("attach").await;
    imported(&w, &[("PAPERAA2", 1), ("PAPERCC3", 2)]).await;
    let group = ImportedSource {
        id: work(3),
        csl_json: r#"{"type":"article-journal","title":"A group paper"}"#.into(),
        zotero_type: "journalArticle".into(),
    };
    import_sources_in(&w.state, vec![group], true)
        .await
        .unwrap();

    let attached = zotero_attach_in(
        &w.state,
        &w.env,
        vec![
            ZoteroAttach {
                work: work(1),
                library: "user".into(),
                key: "ATTACHA2".into(),
            },
            ZoteroAttach {
                work: work(2),
                library: "user".into(),
                key: "ATTACHC3".into(),
            },
            ZoteroAttach {
                work: work(3),
                library: "group:4242".into(),
                key: "GROUPAT2".into(),
            },
        ],
    )
    .await
    .unwrap();

    let trust = &attached[0];
    let path = trust.path.clone().unwrap();
    assert_eq!(
        PathBuf::from(&path),
        w.data.join("storage/ATTACHA2/trust.pdf")
    );
    assert!(trust.file.as_ref().unwrap().needs_ingest);
    assert_eq!(attached[1].reason.as_deref(), Some(read::IN_BASE_FOLDER));
    assert!(attached[2].file.is_some(), "{:?}", attached[2].reason);

    // Nothing copied: the project folder has no PDFs.
    let project = w.state.project_root().await.unwrap();
    let pdfs = std::fs::read_dir(&project)
        .unwrap()
        .filter(|e| {
            e.as_ref()
                .unwrap()
                .path()
                .extension()
                .is_some_and(|x| x == "pdf")
        })
        .count();
    assert_eq!(pdfs, 0);

    // A later session has no picks, and still opens it: it's a recorded place.
    let later = DbState::default();
    later
        .open_library(&w.root.join("library.db"))
        .await
        .unwrap();
    assert!(erti_lib::scope::authorise(&later, &path).await.is_ok());
}

// M1b-11 AC-6
#[tokio::test]
async fn a_pdf_named_by_the_webview_alone_is_refused() {
    let w = linked("unnamed").await;
    imported(&w, &[("PAPERAA2", 1)]).await;
    let attached = zotero_attach_in(
        &w.state,
        &w.env,
        vec![ZoteroAttach {
            work: work(1),
            library: "user".into(),
            // In the bin: Zotero doesn't offer it, so neither does Erti.
            key: "ATTACHE5".into(),
        }],
    )
    .await
    .unwrap();
    assert!(attached[0].file.is_none());
    assert!(attached[0].reason.is_some());

    let refused = zotero_attach_in(
        &w.state,
        &w.env,
        vec![ZoteroAttach {
            work: work(1),
            library: "user".into(),
            key: "../../x".into(),
        }],
    )
    .await
    .unwrap_err();
    assert_eq!(refused.kind, ErrorKind::InvalidInput);
}

// M1b-11 AC-6
#[cfg(unix)]
#[tokio::test]
async fn a_stored_pdf_that_leads_out_of_zoteros_storage_is_refused() {
    let w = linked("symlink").await;
    let outside = w.root.join("secret.pdf");
    pdf(&outside, "secret");
    let stored = w.data.join("storage/ATTACHA2/trust.pdf");
    std::fs::remove_file(&stored).unwrap();
    std::os::unix::fs::symlink(&outside, &stored).unwrap();
    // A fresh copy: the file changed under the one taken before.
    let items = zotero_read_in(&w.state, &w.env, &[pick("user", "item", Some("PAPERAA2"))])
        .await
        .unwrap();
    assert!(items[0].pdfs[0].reason.is_some());
}

// M1b-11 AC-6
#[tokio::test]
async fn works_the_library_had_join_the_project_too() {
    let w = linked("record").await;
    let other = DbState::default();
    other
        .open_library(&w.root.join("library.db"))
        .await
        .unwrap();
    other
        .open_project(&w.root.join("other project"))
        .await
        .unwrap();
    import_sources_in(
        &other,
        vec![ImportedSource {
            id: work(7),
            csl_json: r#"{"type":"book","title":"Had already"}"#.into(),
            zotero_type: "book".into(),
        }],
        true,
    )
    .await
    .unwrap();

    zotero_record_in(
        &w.state,
        vec![ZoteroRecord {
            library: "user".into(),
            key: "PAPERBB2".into(),
            work: work(7),
        }],
    )
    .await
    .unwrap();
    let project = w.state.project().await.unwrap();
    let ids = erti_lib::db::queries::project_source_hashes(&project)
        .await
        .unwrap();
    assert_eq!(ids, [work(7)]);
}

// M1b-11 AC-7
#[tokio::test]
async fn zotero_can_hold_its_library_open_throughout() {
    let w = linked("locked").await;
    // As Zotero does: WAL, an exclusive lock, and a write it hasn't
    // checkpointed.
    let zotero = SqlitePool::connect_with(
        SqliteConnectOptions::new()
            .filename(w.data.join("zotero.sqlite"))
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .locking_mode(sqlx::sqlite::SqliteLockingMode::Exclusive),
    )
    .await
    .unwrap();
    sqlx::query(
        "UPDATE collections SET collectionName = 'Methods, revised' WHERE key = 'METHODS2'",
    )
    .execute(&zotero)
    .await
    .unwrap();

    let tree = zotero_tree_in(&w.state, &w.env).await.unwrap();
    assert_eq!(tree[0].collections[0].name, "Methods, revised");
    zotero.close().await;
}

// M1b-11 AC-7
#[tokio::test]
async fn a_copy_that_doesnt_check_out_is_refused_as_busy() {
    let w = linked("torn").await;
    std::fs::write(
        w.data.join("zotero.sqlite"),
        b"SQLite format 3\0 and then nonsense, as a copy taken mid-write might be",
    )
    .unwrap();
    let refused = zotero_tree_in(&w.state, &w.env).await.unwrap_err();
    assert_eq!(refused.message, read::BUSY);
}

// M1b-11 AC-11
#[tokio::test]
async fn a_zotero_that_reshaped_its_tables_is_refused_plainly() {
    let w = linked("reshaped").await;
    let db = zotero_db(&w.data.join("zotero.sqlite")).await;
    sqlx::raw_sql("ALTER TABLE collections RENAME COLUMN collectionName TO name")
        .execute(&db)
        .await
        .unwrap();
    db.close().await;
    let refused = zotero_tree_in(&w.state, &w.env).await.unwrap_err();
    assert_eq!(refused.message, read::UNREADABLE);
    let refused = zotero_read_in(&w.state, &w.env, &[pick("user", "library", None)])
        .await
        .unwrap_err();
    assert_eq!(refused.message, read::UNREADABLE);
}

// M1b-11 AC-8
#[tokio::test]
async fn a_sync_brings_in_what_is_new_once_and_removes_nothing() {
    let w = linked("sync").await;
    zotero_follow_in(
        &w.state,
        vec![
            pick("user", "collection", Some("THESIS22")),
            pick("user", "collection", Some("METHODS2")),
        ],
    )
    .await
    .unwrap();
    imported(&w, &[("PAPERAA2", 1), ("PAPERBB2", 2), ("PAPERDD4", 3)]).await;

    let plan = zotero_sync_plan_in(&w.state, &w.env).await.unwrap();
    // Thesis's chapter is new; Methods' paper is had, but its PDF isn't
    // attached yet. PAPERDD4 isn't in anything followed any more.
    assert_eq!(keys(&plan.items), ["PAPERCC3"]);
    assert_eq!(
        plan.pdfs,
        [ZoteroAttach {
            work: work(1),
            library: "user".into(),
            key: "ATTACHA2".into()
        }]
    );
    assert_eq!(plan.gone, 1);

    zotero_attach_in(&w.state, &w.env, plan.pdfs).await.unwrap();
    imported(&w, &[("PAPERCC3", 4)]).await;
    let plan = zotero_sync_plan_in(&w.state, &w.env).await.unwrap();
    assert!(plan.items.is_empty());
    assert!(plan.pdfs.is_empty());

    // Added in Zotero later, to a subcollection of one followed.
    let db = zotero_db(&w.data.join("zotero.sqlite")).await;
    sqlx::raw_sql(
        "INSERT INTO items (itemID, itemTypeID, libraryID, key) VALUES (110, 4, 1, 'NEWPAPR2');
         INSERT INTO itemDataValues (valueID, value) VALUES (99, 'Added later');
         INSERT INTO itemData (itemID, fieldID, valueID) VALUES (110, 1, 99);
         INSERT INTO collectionItems (collectionID, itemID) VALUES (12, 110);",
    )
    .execute(&db)
    .await
    .unwrap();
    db.close().await;
    let plan = zotero_sync_plan_in(&w.state, &w.env).await.unwrap();
    assert_eq!(keys(&plan.items), ["NEWPAPR2"]);

    // Nothing removed from the project by any of it.
    let project = w.state.project().await.unwrap();
    let ids = erti_lib::db::queries::project_source_hashes(&project)
        .await
        .unwrap();
    assert_eq!(ids.len(), 4);
}

// M1b-11 AC-8
#[tokio::test]
async fn a_project_that_follows_nothing_has_nothing_to_sync() {
    let w = world("nothing").await;
    let plan = zotero_sync_plan_in(&w.state, &w.env).await.unwrap();
    assert!(plan.items.is_empty() && plan.pdfs.is_empty() && plan.gone == 0);
}

// M1b-11 AC-1
#[tokio::test]
async fn a_new_project_is_a_named_folder_in_a_picked_place() {
    let w = world("create").await;
    let place = w.root.join("Documents");
    std::fs::create_dir_all(&place).unwrap();
    let parent = place.to_string_lossy().to_string();

    let refused = create_project_in(&w.state, &parent, "Thesis")
        .await
        .unwrap_err();
    assert_eq!(refused.kind, ErrorKind::PermissionDenied);

    w.state.grants.grant(&place);
    for bad in ["", "   ", "a/b", "a\\b", "..", ".hidden", "what?"] {
        let refused = create_project_in(&w.state, &parent, bad).await.unwrap_err();
        assert_eq!(refused.kind, ErrorKind::InvalidInput, "{bad:?}");
    }

    let made = create_project_in(&w.state, &parent, " Thesis ")
        .await
        .unwrap();
    assert_eq!(PathBuf::from(&made), place.join("Thesis"));
    assert!(place.join("Thesis").is_dir());

    let taken = create_project_in(&w.state, &parent, "Thesis")
        .await
        .unwrap_err();
    assert_eq!(taken.kind, ErrorKind::Conflict);

    // Opened as any picked folder is.
    erti_lib::db_commands::open_project_in(&w.state, made)
        .await
        .unwrap();
}

// M1b-11 AC-10
#[tokio::test]
async fn a_version_2_project_gains_what_it_follows_and_keeps_its_rows() {
    use erti_lib::db::schema;
    let root = scratch("project-v2");
    let db = SqlitePool::connect_with(
        SqliteConnectOptions::new()
            .filename(root.join(".erti").join("project.db"))
            .create_if_missing(true),
    );
    std::fs::create_dir_all(root.join(".erti")).unwrap();
    let db = db.await.unwrap();
    for migration in &schema::PROJECT_MIGRATIONS[..2] {
        sqlx::raw_sql(migration.sql).execute(&db).await.unwrap();
    }
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
         INSERT INTO schema_version (version) VALUES (2);
         INSERT INTO source_set (sha256) VALUES ('kept');",
    )
    .execute(&db)
    .await
    .unwrap();
    // Twice: an upgrade that stopped part way runs again.
    for _ in 0..2 {
        sqlx::raw_sql(schema::PROJECT_MIGRATIONS[2].sql)
            .execute(&db)
            .await
            .unwrap();
    }
    db.close().await;

    let state = DbState::default();
    state.open_project(&root).await.unwrap();
    let project = state.project().await.unwrap();
    let version: i64 = sqlx::query_scalar("SELECT MAX(version) FROM schema_version")
        .fetch_one(&project)
        .await
        .unwrap();
    assert_eq!(version, 3);
    let ids = erti_lib::db::queries::project_source_hashes(&project)
        .await
        .unwrap();
    assert_eq!(ids, ["kept"]);
    let follows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM zotero_follow")
        .fetch_one(&project)
        .await
        .unwrap();
    assert_eq!(follows, 0);
}

/// Reads the real Zotero library on this machine, and prints only counts.
/// Run by hand: `cargo test --test zotero -- --ignored --nocapture`.
#[tokio::test]
#[ignore]
async fn reads_the_zotero_on_this_machine() {
    let home = PathBuf::from(std::env::var("HOME").unwrap());
    let root = scratch("real");
    let state = DbState::default();
    state.open_library(&root.join("library.db")).await.unwrap();
    let env = Env {
        home: Some(home),
        cache: root.join("cache"),
    };
    zotero_link_in(&state, &env, None).await.unwrap();
    let tree = zotero_tree_in(&state, &env).await.unwrap();
    fn count(c: &[zotero::ZoteroCollection]) -> usize {
        c.iter().map(|c| 1 + count(&c.children)).sum()
    }
    for library in &tree {
        println!(
            "{}: {} papers, {} unfiled, {} collections",
            library.id,
            library.papers,
            library.unfiled,
            count(&library.collections)
        );
    }
    let items = zotero_read_in(&state, &env, &[pick("user", "library", None)])
        .await
        .unwrap();
    let pdfs: usize = items.iter().map(|i| i.pdfs.len()).sum();
    let attachable: usize = items
        .iter()
        .flat_map(|i| &i.pdfs)
        .filter(|p| p.reason.is_none())
        .count();
    println!(
        "read {} papers with {pdfs} PDFs, {attachable} attachable",
        items.len()
    );
    let _ = std::fs::remove_dir_all(&root);
}
