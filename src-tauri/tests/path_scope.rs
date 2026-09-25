//! The path commands only reach what the user has given Erti (M1a-3, T2).
//!
//! Each test goes through the command's own code (`*_in`, which the Tauri
//! command calls with its managed state), not just the scope check, since M1a-10
//! showed a right unit and a wrong command path can coexist.

use std::path::{Path, PathBuf};

use erti_lib::commands::{read_directory_in, read_pdf_file_in};
use erti_lib::db::DbState;
use erti_lib::db_commands::{
    hash_file_in, open_project_in, register_source_in, source_for_path_in,
};
use erti_lib::ipc::ErrorKind;
use erti_lib::scope::{NOT_PICKED, OUTSIDE};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("erti-scope-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(path: &Path, text: &str) -> String {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
    path.to_string_lossy().to_string()
}

/// A library, a project folder holding a paper, and a secret beside it.
struct World {
    state: DbState,
    base: PathBuf,
    project: PathBuf,
    paper: String,
    secret: String,
}

async fn world(name: &str) -> World {
    let base = scratch(name);
    let project = base.join("Thesis");
    let paper = write(&project.join("papers").join("paper.pdf"), "%PDF-1.4 paper");
    let secret = write(&base.join("secret").join("id_rsa"), "PRIVATE KEY");

    let state = DbState::default();
    state
        .open_library(&base.join("library").join("library.db"))
        .await
        .unwrap();
    // Picked in the dialog, as a new project is.
    state.grants.grant(&project);
    open_project_in(&state, project.to_string_lossy().to_string())
        .await
        .unwrap();

    World {
        state,
        base,
        project,
        paper,
        secret,
    }
}

fn is_refused<T: std::fmt::Debug>(result: Result<T, erti_lib::ipc::AppError>) {
    let err = result.unwrap_err();
    assert_eq!(err.kind, ErrorKind::PermissionDenied);
    // M1a-3 AC-4
    assert_eq!(err.message, OUTSIDE);
}

// M1a-3 AC-1
#[tokio::test]
async fn a_paper_in_the_project_opens() {
    let w = world("inside").await;

    assert!(read_pdf_file_in(&w.state, w.paper.clone()).await.is_ok());
    assert!(hash_file_in(&w.state, w.paper.clone()).await.is_ok());
    assert!(source_for_path_in(&w.state, w.paper.clone()).await.is_ok());
    let listing = read_directory_in(&w.state, w.project.to_string_lossy().to_string())
        .await
        .unwrap();
    assert_eq!(listing[0].name, "papers");
}

// M1a-3 AC-1, AC-4
#[tokio::test]
async fn a_file_outside_the_project_is_refused_by_every_command() {
    let w = world("outside").await;

    is_refused(read_pdf_file_in(&w.state, w.secret.clone()).await);
    is_refused(hash_file_in(&w.state, w.secret.clone()).await);
    is_refused(source_for_path_in(&w.state, w.secret.clone()).await);
    is_refused(
        read_directory_in(
            &w.state,
            w.base.join("secret").to_string_lossy().to_string(),
        )
        .await,
    );
    is_refused(
        register_source_in(&w.state, "a".repeat(64), w.secret.clone(), "id_rsa".into()).await,
    );
}

// M1a-3 AC-3
#[tokio::test]
async fn dot_dot_cannot_climb_out_of_the_project() {
    let w = world("dotdot").await;
    let escape = format!("{}/papers/../../secret/id_rsa", w.project.display());
    is_refused(read_pdf_file_in(&w.state, escape).await);
}

// M1a-3 AC-3
#[cfg(unix)]
#[tokio::test]
async fn a_symlink_in_the_project_pointing_out_is_refused() {
    let w = world("symlink").await;

    let link = w.project.join("papers").join("innocent.pdf");
    std::os::unix::fs::symlink(&w.secret, &link).unwrap();
    is_refused(read_pdf_file_in(&w.state, link.to_string_lossy().to_string()).await);

    let dir_link = w.project.join("elsewhere");
    std::os::unix::fs::symlink(w.base.join("secret"), &dir_link).unwrap();
    is_refused(
        read_pdf_file_in(
            &w.state,
            dir_link.join("id_rsa").to_string_lossy().to_string(),
        )
        .await,
    );
}

// M1a-3 AC-3
#[tokio::test]
async fn absolute_paths_elsewhere_and_relative_paths_are_refused() {
    let w = world("elsewhere").await;
    #[cfg(unix)]
    is_refused(read_pdf_file_in(&w.state, "/etc/hosts".into()).await);
    is_refused(read_pdf_file_in(&w.state, "papers/paper.pdf".into()).await);
    is_refused(read_pdf_file_in(&w.state, r"\\server\share\paper.pdf".into()).await);
    is_refused(read_pdf_file_in(&w.state, "C:paper.pdf".into()).await);
}

#[tokio::test]
async fn a_refusal_does_not_say_whether_the_file_exists() {
    let w = world("existence").await;
    let missing = w.base.join("secret").join("no-such-key");
    is_refused(read_pdf_file_in(&w.state, missing.to_string_lossy().to_string()).await);
}

#[tokio::test]
async fn a_missing_paper_in_the_project_is_still_reported_as_missing() {
    let w = world("missing").await;
    let gone = w.project.join("papers").join("moved.pdf");
    let err = read_pdf_file_in(&w.state, gone.to_string_lossy().to_string())
        .await
        .unwrap_err();
    assert_eq!(err.kind, ErrorKind::NotFound);
}

// M1a-3 AC-2
#[tokio::test]
async fn a_folder_picked_in_a_dialog_is_allowed_for_the_session() {
    let w = world("granted").await;
    let elsewhere = write(&w.base.join("Downloads").join("new.pdf"), "%PDF-1.4");
    is_refused(read_pdf_file_in(&w.state, elsewhere.clone()).await);

    w.state.grants.grant(&w.base.join("Downloads"));
    assert!(read_pdf_file_in(&w.state, elsewhere).await.is_ok());
}

// M1a-3 AC-1: a location the library recorded.
#[tokio::test]
async fn a_paper_recorded_by_another_project_still_opens_but_its_neighbours_do_not() {
    let w = world("locations").await;
    let other = w.base.join("Other project");
    let theirs = write(&other.join("theirs.pdf"), "%PDF-1.4 theirs");
    let neighbour = write(&other.join("private.txt"), "not a paper");

    // Registered while that project was open, as ingest does.
    w.state.grants.grant(&other);
    register_source_in(
        &w.state,
        "b".repeat(64),
        theirs.clone(),
        "theirs.pdf".into(),
    )
    .await
    .unwrap();

    // A new session: no grants, this project open.
    let fresh = DbState::default();
    fresh
        .open_library(&w.base.join("library").join("library.db"))
        .await
        .unwrap();
    open_project_in(&fresh, w.project.to_string_lossy().to_string())
        .await
        .unwrap();

    assert!(read_pdf_file_in(&fresh, theirs).await.is_ok());
    is_refused(read_pdf_file_in(&fresh, neighbour).await);
}

#[tokio::test]
async fn only_a_picked_or_known_folder_can_become_the_project() {
    let w = world("open-project").await;

    // Opening `/` would put the whole disk in scope.
    let stranger = w.base.join("secret").to_string_lossy().to_string();
    let err = open_project_in(&w.state, stranger).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::PermissionDenied);
    assert_eq!(err.message, NOT_PICKED);

    // Reopened from the recent list next session: it has an .erti folder now.
    let fresh = DbState::default();
    fresh
        .open_library(&w.base.join("library").join("library.db"))
        .await
        .unwrap();
    let project = w.project.to_string_lossy().to_string();
    assert!(read_directory_in(&fresh, project.clone()).await.is_ok());
    assert!(open_project_in(&fresh, project).await.is_ok());
}

// M1a-4: the landing screen's question, answered without the fs plugin.
#[tokio::test]
async fn only_folders_erti_has_opened_count_as_recent_projects() {
    use erti_lib::db_commands::recent_projects_present;
    let w = world("recents").await;

    let present = recent_projects_present(vec![
        w.project.to_string_lossy().to_string(),
        w.base.join("secret").to_string_lossy().to_string(),
        w.base.join("gone").to_string_lossy().to_string(),
        "relative/path".into(),
    ])
    .await;

    // The project has `.erti/project.db` from being opened; an ordinary folder,
    // a missing one and a relative path all read the same: not a project.
    assert_eq!(present, vec![true, false, false, false]);
}
