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
use std::path::Path;
use std::process::Command;

/// The TeX engines worth trying, best first.
///
/// `latexmk` first because it works out how many passes the document needs —
/// bibliographies take at least three, and getting that wrong yields a PDF with
/// `[?]` where every citation should be. `tectonic` is last but self-contained,
/// fetching what a document needs on first use.
const ENGINES: [&str; 3] = ["latexmk", "pdflatex", "tectonic"];

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
pub struct CompileResult {
    pub ok: bool,
    /// Path to the PDF, when one was produced.
    pub pdf: Option<String>,
    /// The engine's output, kept whether or not it succeeded.
    pub log: String,
}

/// Compile `main.tex` in a bundle directory.
///
/// The log is returned either way. A TeX error is famously hard to read, but it
/// is the only thing that says what went wrong, and hiding it would leave the
/// user with "compilation failed" and nowhere to go.
#[tauri::command]
pub async fn compile_latex(directory: String, engine: String) -> Result<CompileResult, String> {
    if !ENGINES.contains(&engine.as_str()) {
        // The engine name reaches a shell command, so it is checked against the
        // known set rather than trusted from the frontend.
        return Err(format!("{engine} is not a TeX engine Erti runs."));
    }

    let dir = Path::new(&directory).to_path_buf();
    if !dir.join("main.tex").exists() {
        return Err(format!("No main.tex in {}.", dir.display()));
    }

    tokio::task::spawn_blocking(move || {
        let mut command = Command::new(&engine);

        match engine.as_str() {
            // -pdf selects pdflatex; the interaction mode stops it stopping at a
            // prompt no one is there to answer.
            "latexmk" => {
                command.args([
                    "-pdf",
                    "-interaction=nonstopmode",
                    "-halt-on-error",
                    "main.tex",
                ]);
            }
            "tectonic" => {
                command.args(["main.tex"]);
            }
            _ => {
                command.args(["-interaction=nonstopmode", "-halt-on-error", "main.tex"]);
            }
        }

        let output = command
            .current_dir(&dir)
            .output()
            .map_err(|e| format!("Could not run {engine}: {e}"))?;

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
    .map_err(|e| format!("compile task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_unknown_engine_is_refused() {
        // The name reaches a shell command, so anything outside the known set is
        // rejected before it gets there.
        let result = compile_latex("/tmp".into(), "rm -rf /".into()).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a TeX engine"));
    }

    #[tokio::test]
    async fn a_directory_without_a_manuscript_is_reported() {
        let result = compile_latex("/tmp".into(), "pdflatex".into()).await;

        assert!(result.unwrap_err().contains("No main.tex"));
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
