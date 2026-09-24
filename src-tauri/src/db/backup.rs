//! Rotating library backups (ADR 008, M1a-5).
//!
//! The library holds work that can't be regenerated — highlights, notes,
//! labels, reading positions, metadata corrections — in one SQLite file, and
//! until now there was no second copy of it. Backups go in `<library
//! dir>/backups/`, written with `VACUUM INTO`: a consistent, compacted copy
//! taken without stopping writers.
//!
//! - Daily: on open, if the newest backup is more than a day old.
//! - Before a migration: always, named for the schema it upgrades from, so
//!   the copy an upgrade went wrong from is easy to find.
//! - Kept: the 7 most recent days that have a backup, then the newest of each
//!   of the 4 weeks before them. Everything older is deleted.

use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const KEEP_DAYS: usize = 7;
pub const KEEP_WEEKS: usize = 4;
const DAY: u64 = 24 * 60 * 60;

/// Where a library's backups live.
pub fn dir_for(library: &Path) -> PathBuf {
    library
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups")
}

/// Days since 1970-01-01 for a civil date, and back (Howard Hinnant's
/// algorithms). Enough calendar for naming files by UTC date without a
/// date-time dependency.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (
        if m <= 2 {
            yoe + era * 400 + 1
        } else {
            yoe + era * 400
        },
        m,
        d,
    )
}

/// The UTC day `time` falls on, as days since the epoch.
pub fn day_of(time: SystemTime) -> i64 {
    (time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / DAY) as i64
}

/// `YYYY-MM-DD` for a day number.
pub fn date_string(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

/// The day a backup was taken on, read from its name:
/// `library-YYYY-MM-DD.db` or `library-YYYY-MM-DD-before-vN.db`.
pub fn day_of_name(name: &str) -> Option<i64> {
    let date = name.strip_prefix("library-")?.get(..10)?;
    let rest = &name["library-".len() + 10..];
    if !(rest == ".db" || (rest.starts_with("-before-v") && rest.ends_with(".db"))) {
        return None;
    }
    let mut parts = date.split('-');
    let y: i64 = parts.next()?.parse().ok()?;
    let m: i64 = parts.next()?.parse().ok()?;
    let d: i64 = parts.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

/// Which backups to delete, given every backup's name.
///
/// Grouped by day, since a day can hold a daily copy and a pre-migration one:
/// a kept day keeps all of its files. Weeks start on Monday. Names that aren't
/// backups are never touched.
pub fn to_delete(names: &[String]) -> Vec<String> {
    let mut days: Vec<i64> = names.iter().filter_map(|n| day_of_name(n)).collect();
    days.sort_unstable_by(|a, b| b.cmp(a));
    days.dedup();

    let mut kept: Vec<i64> = days.iter().take(KEEP_DAYS).copied().collect();

    // 1970-01-01 was a Thursday, so day + 3 counts weeks from a Monday.
    let week = |day: i64| (day + 3).div_euclid(7);
    let mut weeks_kept: Vec<i64> = Vec::new();
    for &day in days.iter().skip(KEEP_DAYS) {
        let w = week(day);
        if kept.iter().any(|&k| week(k) == w) || weeks_kept.contains(&w) {
            continue;
        }
        if weeks_kept.len() == KEEP_WEEKS {
            break;
        }
        weeks_kept.push(w);
        kept.push(day);
    }

    names
        .iter()
        .filter(|n| matches!(day_of_name(n), Some(day) if !kept.contains(&day)))
        .cloned()
        .collect()
}

/// Backup names in `dir`, or none if it doesn't exist yet.
fn list(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| day_of_name(n).is_some())
                .collect()
        })
        .unwrap_or_default()
}

/// Is a daily backup due: none yet, or the newest more than a day old?
///
/// Judged by the files' modification times rather than their names, since a
/// name only carries the date.
pub fn daily_due(dir: &Path, now: SystemTime) -> bool {
    let newest = list(dir)
        .iter()
        .filter_map(|n| std::fs::metadata(dir.join(n)).ok()?.modified().ok())
        .max();
    match newest {
        Some(at) => now.duration_since(at).unwrap_or_default() > Duration::from_secs(DAY),
        None => true,
    }
}

/// Write a backup of `pool` into `dir`, then prune.
///
/// `VACUUM INTO` refuses to overwrite, so the copy is written under a
/// temporary name and moved into place: a second backup the same day replaces
/// the first rather than failing, and a half-written file never carries a
/// backup's name.
pub async fn write(
    pool: &SqlitePool,
    dir: &Path,
    now: SystemTime,
    before_version: Option<i64>,
) -> Result<PathBuf, String> {
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|e| crate::fs_errors::describe(&e, dir))?;

    let date = date_string(day_of(now));
    let name = match before_version {
        Some(v) => format!("library-{date}-before-v{v}.db"),
        None => format!("library-{date}.db"),
    };
    let target = dir.join(&name);
    let partial = dir.join(format!(".{name}.partial"));
    let _ = tokio::fs::remove_file(&partial).await;

    sqlx::query("VACUUM INTO ?")
        .bind(partial.to_string_lossy().as_ref())
        .execute(pool)
        .await
        .map_err(|e| format!("could not back up the library: {e}"))?;

    tokio::fs::rename(&partial, &target)
        .await
        .map_err(|e| crate::fs_errors::describe(&e, &target))?;

    for old in to_delete(&list(dir)) {
        let _ = tokio::fs::remove_file(dir.join(old)).await;
    }

    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(date: &str) -> i64 {
        day_of_name(&format!("library-{date}.db")).unwrap()
    }

    #[test]
    fn dates_round_trip_through_day_numbers() {
        for date in ["1970-01-01", "2000-02-29", "2026-09-25", "2031-12-31"] {
            assert_eq!(date_string(day(date)), date);
        }
        assert_eq!(day("1970-01-02"), 1);
    }

    #[test]
    fn only_backup_names_are_read_as_backups() {
        assert!(day_of_name("library-2026-09-25.db").is_some());
        assert!(day_of_name("library-2026-09-25-before-v5.db").is_some());
        for other in [
            "library.db",
            "library-2026-13-01.db",
            "library-2026-09-25.db.partial",
            ".library-2026-09-25.db.partial",
            "library-replaced-2026-09-25.db",
            "notes.md",
        ] {
            assert!(day_of_name(other).is_none(), "{other}");
        }
    }

    fn names(dates: &[&str]) -> Vec<String> {
        dates.iter().map(|d| format!("library-{d}.db")).collect()
    }

    // M1a-5 AC-3
    #[test]
    fn keeps_seven_days_then_four_weeks() {
        // Daily backups for 60 days, ending Friday 2026-09-25.
        let end = day("2026-09-25");
        let all: Vec<String> = (0..60)
            .map(|i| format!("library-{}.db", date_string(end - i)))
            .collect();
        let deleted = to_delete(&all);
        let mut kept: Vec<String> = all
            .iter()
            .filter(|n| !deleted.contains(n))
            .cloned()
            .collect();
        kept.sort();

        assert_eq!(
            kept,
            names(&[
                // The newest of each of the four weeks before the dailies.
                "2026-08-23",
                "2026-08-30",
                "2026-09-06",
                "2026-09-13",
                // Seven days: Saturday 19th to Friday 25th.
                "2026-09-19",
                "2026-09-20",
                "2026-09-21",
                "2026-09-22",
                "2026-09-23",
                "2026-09-24",
                "2026-09-25",
            ])
        );
    }

    // M1a-5 AC-3
    #[test]
    fn counts_days_that_have_a_backup_not_calendar_days() {
        // Someone who opens Erti twice a month still has seven copies.
        let sparse = names(&[
            "2026-01-01",
            "2026-02-01",
            "2026-03-01",
            "2026-04-01",
            "2026-05-01",
            "2026-06-01",
            "2026-07-01",
            "2026-08-01",
            "2026-09-01",
        ]);
        let deleted = to_delete(&sparse);
        // Nine days, seven kept as days, the other two as their weeks.
        assert!(deleted.is_empty(), "{deleted:?}");
    }

    // M1a-5 AC-3
    #[test]
    fn a_day_keeps_its_pre_migration_copy_alongside_the_daily() {
        let mut all = names(&["2026-09-24", "2026-09-25"]);
        all.push("library-2026-09-25-before-v5.db".into());
        assert!(to_delete(&all).is_empty());
    }

    #[test]
    fn nothing_that_is_not_a_backup_is_deleted() {
        let mut all: Vec<String> = (0..40)
            .map(|i| format!("library-{}.db", date_string(day("2026-09-25") - i)))
            .collect();
        all.push("library-replaced-2020-01-01.db".into());
        all.push("README.txt".into());
        let deleted = to_delete(&all);
        assert!(!deleted
            .iter()
            .any(|d| d.contains("replaced") || d.contains("README")));
    }
}
