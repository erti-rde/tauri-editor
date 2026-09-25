//! Compiling a LaTeX bundle, when the machine can.
//!
//! Erti does not ship a TeX distribution: TeX Live is several gigabytes, which
//! is not a reasonable thing to bundle with a writing app for the minority of
//! users who will compile locally. Most researchers who want `.tex` are sending
//! it to a journal or opening it in Overleaf, and the bundle is what they need.
//!
//! So compilation is offered when a toolchain is already installed and
//! explained when it is not, rather than being promised and then failing.

use serde::Serialize;
use std::process::Command;

/// The TeX engines worth trying, best first.
///
/// `latexmk` first because it works out how many passes the document needs —
/// bibliographies take at least three, and getting that wrong yields a PDF with
/// `[?]` where every citation should be. `tectonic` is last but self-contained,
/// fetching what a document needs on first use.
const ENGINES: [&str; 3] = ["latexmk", "pdflatex", "tectonic"];

#[derive(Debug, Serialize, specta::Type)]
pub struct TexToolchain {
    /// The engine found, if any.
    pub engine: Option<String>,
    /// Whether BibTeX or Biber is available to resolve citations.
    pub bibliography: Option<String>,
}

fn on_path(program: &str) -> bool {
    // `--version` rather than `which`: it works the same on Windows, and it
    // proves the binary runs rather than merely existing.
    Command::new(program)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// What this machine can do with a `.tex`.
#[tauri::command]
#[specta::specta]
pub async fn detect_tex_toolchain() -> TexToolchain {
    tokio::task::spawn_blocking(|| TexToolchain {
        engine: ENGINES.iter().find(|e| on_path(e)).map(|e| e.to_string()),
        bibliography: ["biber", "bibtex"]
            .iter()
            .find(|b| on_path(b))
            .map(|b| b.to_string()),
    })
    .await
    .unwrap_or(TexToolchain {
        engine: None,
        bibliography: None,
    })
}

#[derive(Debug, Serialize, specta::Type)]
pub struct CompileResult {
    pub ok: bool,
    /// Path to the PDF, when one was produced.
    pub pdf: Option<String>,
    /// The engine's output, kept whether or not it succeeded.
    pub log: String,
}

/// The arguments each engine is run with.
///
/// Shell escape is off explicitly (SEC-11). A `.bib` carries metadata from
/// Crossref, imports and co-authors, and `\write18` in it would otherwise run
/// whatever the user's TeX configuration allows: TeX Live's default is a
/// restricted whitelist, but a machine set up for `minted` or `pythontex` has
/// it fully on, and Erti shouldn't inherit that.
///
/// - `latexmk`: `-pdf` selects pdflatex, and `-no-shell-escape` is passed on to
///   it. `-norc` skips latexmkrc files, which are Perl: one in the project
///   folder would run as code, and the bundle Erti writes needs no settings.
/// - `pdflatex`: `-no-shell-escape` directly.
/// - `tectonic`: no flag. Shell escape is off unless asked for with
///   `-Z shell-escape`, and there is no configuration file that turns it on.
///
/// The interaction mode stops an engine waiting at a prompt no one is there to
/// answer.
fn engine_args(engine: &str) -> &'static [&'static str] {
    match engine {
        "latexmk" => &[
            "-norc",
            "-pdf",
            "-no-shell-escape",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "main.tex",
        ],
        "tectonic" => &["main.tex"],
        _ => &[
            "-no-shell-escape",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "main.tex",
        ],
    }
}

/// Compile `main.tex` in a bundle directory.
///
/// The log is returned either way. A TeX error is famously hard to read, but it
/// is the only thing that says what went wrong, and hiding it would leave the
/// user with "compilation failed" and nowhere to go.
#[tauri::command]
#[specta::specta]
pub async fn compile_latex(
    state: tauri::State<'_, crate::db::DbState>,
    directory: String,
    engine: String,
) -> Result<CompileResult, crate::ipc::AppError> {
    compile_latex_in(&state, directory, engine).await
}

/// `compile_latex`, scoped (M1a-3): TeX runs in the directory it's given and
/// reads whatever `main.tex` there tells it to, so the directory must be one
/// the user has given Erti (the project's `export/`, in practice).
pub async fn compile_latex_in(
    state: &crate::db::DbState,
    directory: String,
    engine: String,
) -> Result<CompileResult, crate::ipc::AppError> {
    if !ENGINES.contains(&engine.as_str()) {
        // The engine name reaches a shell command, so it is checked against the
        // known set rather than trusted from the frontend.
        return Err(crate::ipc::AppError::new(
            crate::ipc::ErrorKind::InvalidInput,
            format!("{engine} is not a TeX engine Erti runs."),
        ));
    }

    let dir = crate::scope::authorise(state, &directory).await?;
    if !dir.join("main.tex").exists() {
        return Err(crate::ipc::AppError::new(
            crate::ipc::ErrorKind::NotFound,
            format!("No main.tex in {}.", dir.display()),
        ));
    }

    tokio::task::spawn_blocking(move || {
        let mut command = Command::new(&engine);
        command.args(engine_args(&engine));

        let output = command
            .current_dir(&dir)
            .output()
            .map_err(|e| crate::ipc::AppError::io(format!("Could not run {engine}: {e}")))?;

        let log = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        let pdf = dir.join("main.pdf");

        // The PDF existing is the real test. pdflatex exits non-zero on
        // warnings that still produced a perfectly good document, and a single
        // pass leaves citations unresolved while exiting zero.
        Ok(CompileResult {
            ok: pdf.exists(),
            pdf: pdf.exists().then(|| pdf.to_string_lossy().to_string()),
            log,
        })
    })
    .await
    .map_err(|e| crate::ipc::AppError::internal(format!("compile task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    // M1a-9 AC-2
    #[test]
    fn no_engine_is_run_with_shell_escape() {
        for engine in ["latexmk", "pdflatex"] {
            let args = engine_args(engine);
            assert!(args.contains(&"-no-shell-escape"), "{engine}: {args:?}");
            assert!(!args
                .iter()
                .any(|a| a.contains("-shell-escape") && *a != "-no-shell-escape"));
            assert!(!args.iter().any(|a| a.contains("shell-restricted")));
        }
        // Off by default in tectonic; asking for it is the only way on.
        assert!(!engine_args("tectonic")
            .iter()
            .any(|a| a.contains("shell-escape")));
    }

    // M1a-9 AC-2
    #[test]
    fn latexmk_reads_no_rc_files() {
        // A latexmkrc is Perl, and one in the project folder would run as code.
        assert_eq!(engine_args("latexmk")[0], "-norc");
    }

    #[test]
    fn every_engine_compiles_main_tex_without_stopping_to_ask() {
        for engine in ENGINES {
            let args = engine_args(engine);
            assert_eq!(args.last(), Some(&"main.tex"), "{engine}");
            if engine != "tectonic" {
                assert!(args.contains(&"-interaction=nonstopmode"), "{engine}");
                assert!(args.contains(&"-halt-on-error"), "{engine}");
            }
        }
    }

    #[tokio::test]
    async fn an_unknown_engine_is_refused() {
        // The name reaches a shell command, so anything outside the known set is
        // rejected before it gets there.
        let state = crate::db::DbState::default();
        let result = compile_latex_in(&state, "/tmp".into(), "rm -rf /".into()).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind, crate::ipc::ErrorKind::InvalidInput);
        assert!(err.message.contains("not a TeX engine"));
    }

    #[tokio::test]
    async fn a_directory_without_a_manuscript_is_reported() {
        let dir = std::env::temp_dir().join(format!("erti-latex-empty-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = crate::db::DbState::default();
        state.grants.grant(&dir);

        let result =
            compile_latex_in(&state, dir.to_string_lossy().to_string(), "pdflatex".into()).await;

        let err = result.unwrap_err();
        assert_eq!(err.kind, crate::ipc::ErrorKind::NotFound);
        assert!(err.message.contains("No main.tex"));
    }

    // M1a-3: the one path command #198 was editing at the time.
    #[tokio::test]
    async fn a_directory_outside_what_the_user_gave_erti_is_refused() {
        let state = crate::db::DbState::default();
        let err = compile_latex_in(&state, "/etc".into(), "pdflatex".into())
            .await
            .unwrap_err();
        assert_eq!(err.kind, crate::ipc::ErrorKind::PermissionDenied);
        assert_eq!(err.message, crate::scope::OUTSIDE);
    }

    #[tokio::test]
    async fn detection_answers_rather_than_failing_when_nothing_is_installed() {
        // A machine with no TeX is the common case, and must not be an error.
        let found = detect_tex_toolchain().await;

        if let Some(engine) = &found.engine {
            assert!(ENGINES.contains(&engine.as_str()));
        }
    }
}
