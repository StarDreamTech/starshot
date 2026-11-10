use crate::imaging;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use tauri_plugin_global_shortcut::Shortcut;

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    pub capture_shortcut: String,
    pub pin_shortcut: String,
    #[serde(default)]
    pub start_in_tray: bool,
    #[serde(default = "default_pin_halo")]
    pub pin_halo: bool,
}

fn default_pin_halo() -> bool {
    true
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettingsStatus {
    #[serde(flatten)]
    pub preferences: DesktopSettings,
    pub autostart: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ShortcutAvailability {
    Available,
    Current,
    Unavailable,
    Invalid,
}

#[derive(Debug, Serialize)]
pub struct ShortcutCheck {
    pub status: ShortcutAvailability,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct ShortcutChecks {
    pub capture: ShortcutCheck,
    pub pin: ShortcutCheck,
}

fn parse_shortcut(value: &str, action: &str) -> Result<Shortcut> {
    if value.len() > 100 {
        return Err(format!("{action}快捷键过长，请重新输入"));
    }
    value
        .trim()
        .parse()
        .map_err(|_| format!("{action}快捷键无效，请输入组合键或 F1–F24"))
}

// `current` means registered by this app, never a system-wide availability query.
// A successful check must release its temporary registration before reporting success.
#[cfg(any(test, not(target_os = "macos")))]
pub fn probe_shortcut(current: bool, mut binding: impl FnMut(bool) -> Result<()>) -> Result<bool> {
    if current {
        return Ok(true);
    }
    binding(true)?;
    binding(false).map_err(|error| {
        format!("检测后未能释放临时快捷键，请退出并重新打开星镜后重试：{error}")
    })?;
    Ok(false)
}

pub fn check_shortcuts(
    capture: &str,
    pin: &str,
    mut probe: impl FnMut(Shortcut) -> Result<bool>,
) -> ShortcutChecks {
    let capture_key = parse_shortcut(capture, "截图");
    let pin_key = parse_shortcut(pin, "贴图");
    let duplicate = matches!((&capture_key, &pin_key), (Ok(a), Ok(b)) if a == b);
    let mut check = |key: Result<Shortcut>| {
        if duplicate {
            return ShortcutCheck {
                status: ShortcutAvailability::Invalid,
                message: "截图与贴图不能使用同一个快捷键".into(),
            };
        }
        match key {
            Err(message) => ShortcutCheck {
                status: ShortcutAvailability::Invalid,
                message,
            },
            Ok(key) => match probe(key) {
                Ok(current) => ShortcutCheck {
                    status: if current {
                        ShortcutAvailability::Current
                    } else {
                        ShortcutAvailability::Available
                    },
                    message: if current {
                        "星镜已注册此快捷键，可继续使用".into()
                    } else {
                        "当前可注册；保存时会再次检查".into()
                    },
                },
                Err(message) => ShortcutCheck {
                    status: ShortcutAvailability::Unavailable,
                    message,
                },
            },
        }
    };
    ShortcutChecks {
        capture: check(capture_key),
        pin: check(pin_key),
    }
}

pub fn registration_error(shortcut: Shortcut, error: impl std::fmt::Display) -> String {
    // The plugin erases the native error type; macOS also drops OSStatus. Do not
    // invent the occupying app or report every registration failure as a conflict.
    format!("快捷键 {shortcut} 无法注册，可能已被占用或由系统保留：{error}")
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            capture_shortcut: "CommandOrControl+Shift+2".into(),
            pin_shortcut: "CommandOrControl+Alt+3".into(),
            start_in_tray: false,
            pin_halo: true,
        }
    }
}

impl DesktopSettings {
    pub fn shortcuts(&self) -> Result<[Shortcut; 2]> {
        let capture = parse_shortcut(&self.capture_shortcut, "截图")?;
        let pin = parse_shortcut(&self.pin_shortcut, "贴图")?;
        if capture == pin {
            return Err("截图与贴图不能使用同一个快捷键".into());
        }
        Ok([capture, pin])
    }
}

pub fn load(directory: &Path) -> Result<DesktopSettings> {
    let path = directory.join("desktop-settings.json");
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DesktopSettings::default())
        }
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 4096 {
        return Err("桌面设置文件无效，已使用默认快捷键".into());
    }
    let settings: DesktopSettings =
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|_| "桌面设置无法读取，已使用默认快捷键")?;
    settings.shortcuts()?;
    Ok(settings)
}

pub fn save(directory: &Path, settings: &DesktopSettings) -> Result<()> {
    settings.shortcuts()?;
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let path = directory.join("desktop-settings.json");
    if fs::symlink_metadata(&path)
        .is_ok_and(|meta| !meta.is_file() || meta.file_type().is_symlink())
    {
        return Err("桌面设置文件不是普通文件，未写入".into());
    }
    imaging::atomic_save(
        &path,
        &serde_json::to_vec(settings).map_err(|e| e.to_string())?,
    )
}

// Only our two bindings are replaced; unrelated application registrations stay intact.
pub fn replace_shortcuts(
    old: &DesktopSettings,
    next: &DesktopSettings,
    binding: impl FnMut(Shortcut, bool) -> Result<bool>,
    persist: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let previous = old.shortcuts()?;
    let replacement = next.shortcuts()?;
    replace_bindings(&previous, &replacement, binding, persist)
}

// Also used for a session-only pause/resume; an empty replacement releases our keys.
pub fn replace_bindings(
    previous: &[Shortcut],
    replacement: &[Shortcut],
    mut binding: impl FnMut(Shortcut, bool) -> Result<bool>,
    persist: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let mut removed = Vec::new();
    let mut added = Vec::new();
    let result = (|| {
        for &shortcut in previous {
            // Some platform APIs can change their bookkeeping before reporting
            // an unregister failure, so also roll back the attempted binding.
            removed.push(shortcut);
            if !binding(shortcut, false).map_err(|e| format!("解除快捷键 {shortcut} 失败：{e}"))?
            {
                removed.pop();
            }
        }
        for &shortcut in replacement {
            if binding(shortcut, true).map_err(|e| format!("设置快捷键 {shortcut} 失败：{e}"))?
            {
                added.push(shortcut);
            }
        }
        persist()
    })();
    if let Err(error) = result {
        let mut rollback = Vec::new();
        for shortcut in added {
            if let Err(cause) = binding(shortcut, false) {
                rollback.push(cause);
            }
        }
        for shortcut in removed {
            if let Err(cause) = binding(shortcut, true) {
                rollback.push(cause);
            }
        }
        return Err(if rollback.is_empty() {
            format!("快捷键未更改，已恢复原设置：{error}")
        } else {
            format!(
                "快捷键更改失败：{error}。部分旧快捷键恢复失败，请使用按钮并重新设置：{}",
                rollback.join("；")
            )
        });
    }
    Ok(())
}

pub fn update_startup(
    previous: bool,
    next: bool,
    mut apply_and_check: impl FnMut(bool) -> Result<()>,
    persist: impl FnOnce() -> Result<()>,
) -> Result<()> {
    if previous == next {
        return persist();
    }
    let result = apply_and_check(next).and_then(|_| persist());
    if let Err(error) = result {
        return Err(match apply_and_check(previous) {
            Ok(()) => format!("启动设置未更改，已恢复原状态：{error}"),
            Err(rollback) => format!(
                "启动设置保存失败：{error}；恢复原系统状态失败：{rollback}。请刷新检查实际状态。"
            ),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn pause_and_resume_release_only_our_keys_and_rollback_conflicts() {
        let keys = DesktopSettings::default().shortcuts().unwrap();
        let unrelated: Shortcut = "Control+Alt+F12".parse().unwrap();
        let mut active = HashSet::from([keys[0].id(), keys[1].id(), unrelated.id()]);
        let change = |active: &mut HashSet<_>, key: Shortcut, register| {
            Ok(if register {
                active.insert(key.id())
            } else {
                active.remove(&key.id())
            })
        };
        replace_bindings(
            &keys,
            &[],
            |key, register| change(&mut active, key, register),
            || Ok(()),
        )
        .unwrap();
        assert_eq!(active, HashSet::from([unrelated.id()]));
        let error = replace_bindings(
            &[],
            &keys,
            |key, register| {
                if register && key == keys[1] {
                    return Err("occupied".into());
                }
                change(&mut active, key, register)
            },
            || Ok(()),
        )
        .unwrap_err();
        assert!(error.contains("occupied"));
        assert_eq!(active, HashSet::from([unrelated.id()]));
        replace_bindings(
            &[],
            &keys,
            |key, register| change(&mut active, key, register),
            || Ok(()),
        )
        .unwrap();
        assert_eq!(
            active,
            HashSet::from([keys[0].id(), keys[1].id(), unrelated.id()])
        );
        let mut failed = false;
        assert!(replace_bindings(
            &keys,
            &[],
            |key, register| {
                if !register && key == keys[1] && !failed {
                    failed = true;
                    return Err("cannot release".into());
                }
                change(&mut active, key, register)
            },
            || Ok(())
        )
        .is_err());
        assert_eq!(
            active,
            HashSet::from([keys[0].id(), keys[1].id(), unrelated.id()])
        );
    }

    #[test]
    fn shortcut_checks_preserve_current_bindings_and_release_only_the_probe() {
        let current: Shortcut = "Control+Shift+2".parse().unwrap();
        let other_current: Shortcut = "Control+Shift+3".parse().unwrap();
        let candidate: Shortcut = "Control+Shift+4".parse().unwrap();
        let previous = HashSet::from([current.id(), other_current.id()]);
        let mut active = previous.clone();
        let mut operations = Vec::new();
        let result = check_shortcuts("Control+Shift+2", "Control+Shift+4", |key| {
            probe_shortcut(active.contains(&key.id()), |register| {
                operations.push((key, register));
                if register {
                    assert!(active.insert(key.id()));
                } else {
                    assert!(active.remove(&key.id()));
                }
                Ok(())
            })
        });
        assert_eq!(active, previous);
        assert_eq!(operations, vec![(candidate, true), (candidate, false)]);
        let json = serde_json::to_value(result).unwrap();
        assert_eq!(json["capture"]["status"], "current");
        assert_eq!(json["pin"]["status"], "available");
    }

    #[test]
    fn checks_reject_equivalent_duplicates_and_keep_field_errors_separate() {
        let duplicate = check_shortcuts("Ctrl+Shift+2", "Control+Shift+2", |_| {
            panic!("duplicate bindings must not be registered")
        });
        assert_eq!(duplicate.capture.status, ShortcutAvailability::Invalid);
        assert_eq!(duplicate.pin.status, ShortcutAvailability::Invalid);
        let mut checked = Vec::new();
        let result = check_shortcuts("not a shortcut", "F8", |key| {
            checked.push(key);
            Err(registration_error(key, "native registration failed"))
        });
        assert_eq!(checked, vec!["F8".parse::<Shortcut>().unwrap()]);
        assert_eq!(result.capture.status, ShortcutAvailability::Invalid);
        assert!(result.capture.message.contains("截图"));
        assert_eq!(result.pin.status, ShortcutAvailability::Unavailable);
        assert!(result.pin.message.contains("可能已被占用"));
        assert!(result.pin.message.contains("F8"));
    }

    #[test]
    fn failed_probes_never_unregister_an_occupied_key_or_claim_cleanup_succeeded() {
        let mut operations = Vec::new();
        let occupied = probe_shortcut(false, |register| {
            operations.push(register);
            Err("occupied".into())
        });
        assert_eq!(occupied.unwrap_err(), "occupied");
        assert_eq!(operations, vec![true]);

        operations.clear();
        let cleanup_failed = probe_shortcut(false, |register| {
            operations.push(register);
            if register {
                Ok(())
            } else {
                Err("native cleanup failed".into())
            }
        });
        assert!(cleanup_failed.unwrap_err().contains("未能释放临时快捷键"));
        assert_eq!(operations, vec![true, false]);
    }

    #[test]
    fn shortcut_changes_roll_back_registration_and_disk_failures() {
        let old = DesktopSettings::default();
        let next = DesktopSettings {
            capture_shortcut: "Control+Shift+4".into(),
            pin_shortcut: "Control+Shift+5".into(),
            start_in_tray: false,
            pin_halo: true,
        };
        let previous: HashSet<_> = old
            .shortcuts()
            .unwrap()
            .into_iter()
            .map(|s| s.id())
            .collect();
        for fail_registration in [true, false] {
            let mut active = previous.clone();
            let bad = next.shortcuts().unwrap()[1].id();
            let result = replace_shortcuts(
                &old,
                &next,
                |shortcut, register| {
                    if register && fail_registration && shortcut.id() == bad {
                        return Err("occupied".into());
                    }
                    if register {
                        active.insert(shortcut.id());
                    } else {
                        active.remove(&shortcut.id());
                    }
                    Ok(true)
                },
                || Err("disk full".into()),
            );
            let error = result.unwrap_err();
            if fail_registration {
                assert!(error.contains("设置快捷键"));
                assert!(error.contains(&next.shortcuts().unwrap()[1].to_string()));
            }
            assert_eq!(active, previous);
        }
        let duplicate = DesktopSettings {
            capture_shortcut: "Control+Shift+2".into(),
            pin_shortcut: "Ctrl+Shift+2".into(),
            start_in_tray: false,
            pin_halo: true,
        };
        assert!(duplicate.shortcuts().is_err());
    }

    #[test]
    fn rollback_does_not_remove_a_binding_that_was_already_registered() {
        let old = DesktopSettings::default();
        let next = DesktopSettings {
            capture_shortcut: "Control+Shift+4".into(),
            pin_shortcut: "Control+Shift+5".into(),
            ..old.clone()
        };
        let mut active: HashSet<_> = old
            .shortcuts()
            .unwrap()
            .into_iter()
            .map(|key| key.id())
            .collect();
        active.insert(next.shortcuts().unwrap()[0].id());
        let previous = active.clone();
        assert!(replace_shortcuts(
            &old,
            &next,
            |key, register| {
                Ok(if register {
                    active.insert(key.id())
                } else {
                    active.remove(&key.id())
                })
            },
            || Err("disk full".into()),
        )
        .is_err());
        assert_eq!(active, previous);
    }
    #[test]
    fn failed_removal_restores_already_removed_binding_and_valid_settings_roundtrip() {
        let old = DesktopSettings::default();
        let previous = old.shortcuts().unwrap();
        let mut active: HashSet<_> = previous.into_iter().map(|shortcut| shortcut.id()).collect();
        let next = DesktopSettings {
            capture_shortcut: "Control+Shift+4".into(),
            ..old.clone()
        };
        let result = replace_shortcuts(
            &old,
            &next,
            |shortcut, register| {
                if !register && shortcut == previous[1] {
                    active.remove(&shortcut.id());
                    return Err("unregister failed".into());
                }
                if register {
                    active.insert(shortcut.id());
                } else {
                    active.remove(&shortcut.id());
                }
                Ok(true)
            },
            || Ok(()),
        );
        assert!(result.is_err());
        assert_eq!(
            active,
            previous.into_iter().map(|shortcut| shortcut.id()).collect()
        );
        let directory = tempfile::tempdir().unwrap();
        save(directory.path(), &old).unwrap();
        assert_eq!(load(directory.path()).unwrap(), old);
        fs::write(directory.path().join("desktop-settings.json"), "bad json").unwrap();
        assert!(load(directory.path()).is_err());
    }
    #[test]
    fn startup_failure_rolls_back_system_state_and_tray_preference_is_compatible() {
        let mut state = false;
        assert!(update_startup(
            false,
            true,
            |enabled| {
                state = enabled;
                Ok(())
            },
            || Err("disk full".into())
        )
        .is_err());
        assert!(!state);
        let parsed: DesktopSettings = serde_json::from_str(
            r#"{"captureShortcut":"Control+Shift+2","pinShortcut":"Control+Shift+3"}"#,
        )
        .unwrap();
        assert!(!parsed.start_in_tray);
        assert!(parsed.pin_halo);
        let json = serde_json::to_value(DesktopSettingsStatus {
            preferences: parsed,
            autostart: true,
        })
        .unwrap();
        assert_eq!(json["autostart"], true);
        assert_eq!(json["startInTray"], false);
        assert_eq!(json["pinHalo"], true);
    }
    #[test]
    fn pin_halo_defaults_on_and_disabled_preference_survives_reload() {
        let directory = tempfile::tempdir().unwrap();
        assert!(load(directory.path()).unwrap().pin_halo);
        let disabled = DesktopSettings {
            pin_halo: false,
            ..DesktopSettings::default()
        };
        save(directory.path(), &disabled).unwrap();
        assert_eq!(load(directory.path()).unwrap(), disabled);
        fs::write(
            directory.path().join("desktop-settings.json"),
            r#"{"captureShortcut":"Control+Shift+2","pinShortcut":"Control+Shift+3"}"#,
        )
        .unwrap();
        assert!(load(directory.path()).unwrap().pin_halo);
    }
    #[test]
    fn missing_old_binding_does_not_prevent_change_or_get_registered_during_rollback() {
        let old = DesktopSettings::default();
        let old_keys = old.shortcuts().unwrap();
        let next = DesktopSettings {
            capture_shortcut: "Control+Shift+4".into(),
            pin_shortcut: "Control+Shift+5".into(),
            start_in_tray: false,
            pin_halo: true,
        };
        for fail in [false, true] {
            let mut active = HashSet::from([old_keys[0].id()]);
            let target = next.shortcuts().unwrap();
            let result = replace_shortcuts(
                &old,
                &next,
                |key, register| {
                    if register {
                        if fail && key == target[1] {
                            return Err("occupied".into());
                        }
                        assert_ne!(key, old_keys[1]);
                        Ok(active.insert(key.id()))
                    } else {
                        Ok(active.remove(&key.id()))
                    }
                },
                || Ok(()),
            );
            if fail {
                assert!(result.is_err());
                assert_eq!(active, HashSet::from([old_keys[0].id()]));
            } else {
                assert!(result.is_ok());
                assert_eq!(active, target.into_iter().map(|key| key.id()).collect());
            }
        }
    }
}
