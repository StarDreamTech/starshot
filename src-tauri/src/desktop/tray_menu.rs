use super::*;
use tauri::menu::{CheckMenuItem, PredefinedMenuItem, Submenu};
use tauri_plugin_global_shortcut::Shortcut;

struct TrayMenu {
    capture: MenuItem<tauri::Wry>,
    pin: MenuItem<tauri::Wry>,
    visibility: MenuItem<tauri::Wry>,
    recover: MenuItem<tauri::Wry>,
    close: MenuItem<tauri::Wry>,
    pause: CheckMenuItem<tauri::Wry>,
    halo: CheckMenuItem<tauri::Wry>,
}

// Text only: registering a menu accelerator as well as a global hotkey can dispatch twice.
fn shortcut_label(value: &str, mac: bool) -> String {
    value
        .split('+')
        .map(|part| {
            let key = part.trim();
            match key.to_ascii_lowercase().as_str() {
                "commandorcontrol" | "cmdorctrl" => if mac { "⌘" } else { "Ctrl" }.into(),
                "super" | "meta" => if mac { "⌘" } else { "Win" }.into(),
                "command" | "cmd" => "⌘".into(),
                "control" | "ctrl" => "Ctrl".into(),
                "alt" | "option" => if mac { "⌥" } else { "Alt" }.into(),
                "shift" => if mac { "⇧" } else { "Shift" }.into(),
                _ => key
                    .strip_prefix("Key")
                    .or_else(|| key.strip_prefix("Digit"))
                    .unwrap_or(key)
                    .into(),
            }
        })
        .collect::<Vec<String>>()
        .join(if mac { "" } else { "+" })
}

fn action_label(app: &AppHandle, title: &str, shortcut: &str, paused: bool) -> String {
    let active = shortcut
        .parse::<Shortcut>()
        .is_ok_and(|key| app.global_shortcut().is_registered(key));
    if paused {
        format!("{title}（快捷键已暂停）")
    } else if active {
        format!(
            "{title}    {}",
            shortcut_label(shortcut, cfg!(target_os = "macos"))
        )
    } else {
        format!("{title}（快捷键不可用）")
    }
}

pub(super) fn build(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id, title| MenuItem::with_id(app, id, title, true, None::<&str>);
    let capture = item("capture", "开始截图")?;
    let pin = item("pin", "贴出最近截图原图")?;
    let visibility = item("toggle-pins", "隐藏全部贴图")?;
    let recover = item("recover", "恢复所有贴图鼠标操作")?;
    let close = item("close-pins", "关闭全部贴图")?;
    let pause = CheckMenuItem::with_id(
        app,
        "pause-shortcuts",
        "暂停全局快捷键",
        true,
        false,
        None::<&str>,
    )?;
    let halo = CheckMenuItem::with_id(
        app,
        "pin-halo",
        "显示贴图焦点光圈",
        true,
        true,
        None::<&str>,
    )?;
    let pins = Submenu::with_items(
        app,
        "贴图管理",
        true,
        &[
            &recover,
            &close,
            &PredefinedMenuItem::separator(app)?,
            &halo,
        ],
    )?;
    let menu = Menu::with_items(
        app,
        &[
            &capture,
            &pin,
            &visibility,
            &PredefinedMenuItem::separator(app)?,
            &pause,
            &pins,
            &PredefinedMenuItem::separator(app)?,
            &item("show", "打开图片编辑器")?,
            &item("settings", "偏好设置…")?,
            &item("updates", "检查更新…")?,
            &item("help", "截图操作说明…")?,
            &item("about", "关于星镜…")?,
            &PredefinedMenuItem::separator(app)?,
            &item("quit", "退出星镜")?,
        ],
    )?;
    app.manage(TrayMenu {
        capture,
        pin,
        visibility,
        recover,
        close,
        pause,
        halo,
    });
    refresh(app);
    Ok(menu)
}

// Queue updates without holding state locks while native menus dispatch onto the UI thread.
// try_lock also avoids waiting back on a worker registering a shortcut on this thread.
pub(super) fn refresh(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(menu) = handle.try_state::<TrayMenu>() else {
            return;
        };
        let context = handle.state::<Context>();
        let (Ok(settings), Ok(current), Ok(pins), Ok(frames), Ok(editor)) = (
            context.settings.try_lock(),
            context.current.try_lock(),
            context.pins.try_lock(),
            context.frames.try_lock(),
            context.editor.try_lock(),
        ) else {
            return;
        };
        let preferences = settings.clone();
        let has_image = current.is_some();
        let count = pins.len();
        let idle = frames.is_empty() && !editor.exit_pending && !editor.busy;
        drop((settings, current, pins, frames, editor));
        let paused = context.shortcuts_paused.load(Ordering::Acquire);
        let idle = idle && handle.state::<Updates>().ensure_idle().is_ok();
        let visible = handle.webview_windows().iter().any(|(label, window)| {
            label.starts_with("pin-") && window.is_visible().unwrap_or(false)
        });
        let _ = menu.capture.set_text(action_label(
            &handle,
            "开始截图",
            &preferences.capture_shortcut,
            paused,
        ));
        let _ = menu.pin.set_text(action_label(
            &handle,
            "贴出最近截图原图",
            &preferences.pin_shortcut,
            paused,
        ));
        let _ = menu.capture.set_enabled(idle);
        let _ = menu.pin.set_enabled(idle && has_image && count < 12);
        let _ = menu.visibility.set_text(format!(
            "{}全部贴图（{count}）",
            if visible { "隐藏" } else { "显示" }
        ));
        for item in [&menu.visibility, &menu.recover, &menu.close] {
            let _ = item.set_enabled(idle && count > 0);
        }
        let _ = menu.pause.set_enabled(idle);
        let _ = menu.pause.set_checked(paused);
        let _ = menu.halo.set_enabled(idle);
        let _ = menu.halo.set_checked(preferences.pin_halo);
    });
}

fn toggle_shortcuts(app: &AppHandle) -> Result<()> {
    let context = app.state::<Context>();
    let _operation = context
        .operation
        .try_lock()
        .map_err(|_| "正在处理图片，请稍后重试")?;
    context.ensure_not_exiting()?;
    app.state::<Updates>().ensure_idle()?;
    no_active_capture(&context)?;
    if context.shortcut_recording.load(Ordering::Acquire)
        || !lock(&context.shortcut_probes)?.is_empty()
    {
        return Err("请先完成快捷键录入或占用检测".into());
    }
    let settings = lock(&context.settings)?.clone();
    let paused = context.shortcuts_paused.load(Ordering::Acquire);
    let keys = settings.shortcuts()?;
    let previous: Vec<_> = keys
        .iter()
        .copied()
        .filter(|key| app.global_shortcut().is_registered(*key))
        .collect();
    let next = if paused { keys.as_slice() } else { &[] };
    desktop_settings::replace_bindings(
        &previous,
        next,
        |key, register| {
            if register {
                if app.global_shortcut().is_registered(key) {
                    return Ok(false);
                }
                #[cfg(target_os = "macos")]
                if !previous.contains(&key) {
                    crate::macos_shortcuts::probe(app, key)?;
                }
                app.global_shortcut()
                    .register(key)
                    .map_err(|e| desktop_settings::registration_error(key, e))?;
            } else {
                if !app.global_shortcut().is_registered(key) {
                    return Ok(false);
                }
                app.global_shortcut()
                    .unregister(key)
                    .map_err(|e| e.to_string())?;
            }
            Ok(true)
        },
        || Ok(()),
    )?;
    context.shortcuts_paused.store(!paused, Ordering::Release);
    let _ = app.emit("shortcuts-paused", !paused);
    *lock(&context.shortcut_error)? = None;
    Ok(())
}

fn manage_pins(app: &AppHandle, action: &str) -> Result<()> {
    let context = app.state::<Context>();
    let _operation = context
        .operation
        .try_lock()
        .map_err(|_| "正在处理图片，请稍后重试")?;
    context.ensure_not_exiting()?;
    app.state::<Updates>().ensure_idle()?;
    no_active_capture(&context)?;
    let windows: Vec<_> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("pin-"))
        .collect();
    let hide = action == "toggle-pins"
        && windows
            .iter()
            .any(|(_, window)| window.is_visible().unwrap_or(false));
    let mut errors = Vec::new();
    for (label, window) in windows {
        let result = match action {
            "close-pins" => window.destroy(),
            "toggle-pins" if hide => window.hide(),
            "toggle-pins" => window.show(),
            _ => window
                .set_ignore_cursor_events(false)
                .and_then(|()| window.show()),
        };
        match result {
            Ok(()) if action == "close-pins" => {
                lock(&context.pins)?.remove(&label);
            }
            Ok(()) => (),
            Err(error) => errors.push(error.to_string()),
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("部分贴图操作失败：{}", errors.join("；")))
    }
}

fn toggle_halo(app: &AppHandle) -> Result<()> {
    let context = app.state::<Context>();
    let _operation = context
        .operation
        .try_lock()
        .map_err(|_| "正在处理图片，请稍后重试")?;
    context.ensure_not_exiting()?;
    app.state::<Updates>().ensure_idle()?;
    no_active_capture(&context)?;
    let mut settings = lock(&context.settings)?;
    let next = DesktopSettings {
        pin_halo: !settings.pin_halo,
        ..settings.clone()
    };
    desktop_settings::save(
        &app.path().app_data_dir().map_err(|e| e.to_string())?,
        &next,
    )?;
    *settings = next;
    let enabled = settings.pin_halo;
    drop(settings);
    let _ = app.emit("pin-halo", enabled);
    Ok(())
}

pub(super) fn handle(app: &AppHandle, id: &str) {
    match id {
        "show" => show_main(app),
        "capture" => dispatch_capture(app),
        "pin" => dispatch_pin(app),
        "settings" | "updates" | "help" | "about" => {
            let result = (|| -> Result<()> {
                let context = app.state::<Context>();
                context.ensure_not_exiting()?;
                no_active_capture(&context)?;
                *lock(&context.pending_menu_request)? = Some(id.into());
                show_main_window(app)?;
                let _ = app.emit_to("main", "menu-requested", ());
                Ok(())
            })();
            if let Err(error) = result {
                report_error(app, &error);
            }
        }
        "quit" => {
            if let Err(error) = begin_exit(app) {
                report_error(app, &error);
            }
        }
        "pause-shortcuts" | "toggle-pins" | "recover" | "close-pins" | "pin-halo" => {
            let app = app.clone();
            let id = id.to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                let result = match id.as_str() {
                    "pause-shortcuts" => toggle_shortcuts(&app),
                    "pin-halo" => toggle_halo(&app),
                    _ => manage_pins(&app, &id),
                };
                if let Err(error) = result {
                    report_error(&app, &error);
                }
                refresh(&app);
            });
        }
        _ => (),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn menu_shortcuts_are_readable_on_both_platforms() {
        assert_eq!(shortcut_label("CommandOrControl+Shift+2", true), "⌘⇧2");
        assert_eq!(
            shortcut_label("CommandOrControl+Alt+3", false),
            "Ctrl+Alt+3"
        );
        assert_eq!(shortcut_label("F1", true), "F1");
        assert_eq!(shortcut_label("Super+KeyK", false), "Win+K");
    }
}
