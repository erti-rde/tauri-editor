//! `src/lib/ipc/bindings.ts` is generated from the Rust commands (ADR 011).
//! If this fails, the TypeScript side no longer matches Rust: regenerate with
//! `pnpm ipc:bindings` and commit the result.

const BINDINGS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib/ipc/bindings.ts");

#[test]
fn bindings_are_current() {
    let generated = erti_lib::bindings().expect("generate bindings");

    if std::env::var_os("UPDATE_BINDINGS").is_some() {
        std::fs::write(BINDINGS, &generated).expect("write bindings");
        return;
    }

    let committed = std::fs::read_to_string(BINDINGS)
        .expect("src/lib/ipc/bindings.ts is missing: run `pnpm ipc:bindings`");
    assert!(
        committed == generated,
        "src/lib/ipc/bindings.ts is out of date with the Rust commands: run `pnpm ipc:bindings`"
    );
}
