//! macOS Carbon registrations are shared by default. Probe with the SDK's
//! kEventHotKeyExclusive option to detect conflicting exclusive registrations.
//! macOS can still accept this probe while another app has a shared registration.
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

type Result<T> = std::result::Result<T, String>;
static CLEANUP_FAILED: AtomicBool = AtomicBool::new(false);
const RESTART_REQUIRED: &str = "上次检测未能释放临时快捷键，请退出并重新打开星镜后重试";
const EXCLUSIVE: u32 = 1;
const HOTKEY_EXISTS: i32 = -9878;
// global-hotkey ignores Carbon signatures, so the probe also uses an ID outside
// its parsed shortcuts' modifier/code range. It is never in the plugin's map.
const PROBE_ID: u32 = u32::MAX;

#[repr(C)]
struct EventHotKeyId {
    signature: u32,
    id: u32,
}

#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn GetApplicationEventTarget() -> *mut c_void;
    fn RegisterEventHotKey(
        code: u32,
        modifiers: u32,
        id: EventHotKeyId,
        target: *mut c_void,
        options: u32,
        reference: *mut *mut c_void,
    ) -> i32;
    fn UnregisterEventHotKey(reference: *mut c_void) -> i32;
}

pub fn ensure_clean() -> Result<()> {
    if CLEANUP_FAILED.load(Ordering::Acquire) {
        Err(RESTART_REQUIRED.into())
    } else {
        Ok(())
    }
}

pub fn probe(app: &AppHandle, shortcut: Shortcut) -> Result<()> {
    ensure_clean()?;
    if objc2::MainThreadMarker::new().is_some() {
        return probe_on_main(shortcut);
    }
    let (sent, received) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sent.send(probe_on_main(shortcut));
    })
    .map_err(|error| format!("无法检测快捷键：{error}"))?;
    received
        .recv()
        .map_err(|_| "无法取得快捷键检测结果".to_string())?
}

fn probe_on_main(shortcut: Shortcut) -> Result<()> {
    let _main = objc2::MainThreadMarker::new().ok_or("快捷键检测必须在主线程运行")?;
    let code = key_to_scancode(shortcut.key).ok_or_else(|| {
        format!("快捷键 {shortcut} 无法进行系统占用检测，请改用普通组合键或 F1–F20")
    })?;
    probe_registration(
        shortcut,
        &CLEANUP_FAILED,
        || {
            let mut reference = std::ptr::null_mut();
            let status = unsafe {
                RegisterEventHotKey(
                    code,
                    carbon_modifiers(shortcut.mods),
                    EventHotKeyId {
                        signature: u32::from_be_bytes(*b"StPr"),
                        id: PROBE_ID,
                    },
                    GetApplicationEventTarget(),
                    EXCLUSIVE,
                    &mut reference,
                )
            };
            if status == 0 {
                Ok(reference)
            } else {
                Err(status)
            }
        },
        |reference| unsafe { UnregisterEventHotKey(reference) },
    )
}

fn probe_registration<T>(
    shortcut: Shortcut,
    cleanup_failed: &AtomicBool,
    register: impl FnOnce() -> std::result::Result<T, i32>,
    unregister: impl FnOnce(T) -> i32,
) -> Result<()> {
    if cleanup_failed.load(Ordering::Acquire) {
        return Err(RESTART_REQUIRED.into());
    }
    let reference = register().map_err(|status| {
        if status == HOTKEY_EXISTS {
            format!("快捷键 {shortcut} 已被占用，请换一个组合键")
        } else {
            format!("快捷键 {shortcut} 无法注册，可能由系统保留（macOS 错误 {status}）")
        }
    })?;
    let status = unregister(reference);
    if status != 0 {
        cleanup_failed.store(true, Ordering::Release);
        return Err(format!("检测后未能释放临时快捷键 {shortcut}，请退出并重新打开星镜后重试（macOS 错误 {status}）"));
    }
    Ok(())
}

fn carbon_modifiers(modifiers: Modifiers) -> u32 {
    let mut flags = 0;
    for (mask, flag) in [
        (Modifiers::SHIFT, 512),
        (Modifiers::SUPER | Modifiers::META, 256),
        (Modifiers::ALT, 2048),
        (Modifiers::CONTROL, 4096),
    ] {
        if modifiers.intersects(mask) {
            flags |= flag;
        }
    }
    flags
}

// Fixed virtual-key values from the macOS SDK Events.h, matching global-hotkey
// 0.8's Code mapping. Unsupported/media-event keys cannot use Carbon probing.
fn key_to_scancode(code: Code) -> Option<u32> {
    match code {
        Code::KeyA => Some(0x00),
        Code::KeyS => Some(0x01),
        Code::KeyD => Some(0x02),
        Code::KeyF => Some(0x03),
        Code::KeyH => Some(0x04),
        Code::KeyG => Some(0x05),
        Code::KeyZ => Some(0x06),
        Code::KeyX => Some(0x07),
        Code::KeyC => Some(0x08),
        Code::KeyV => Some(0x09),
        Code::KeyB => Some(0x0b),
        Code::KeyQ => Some(0x0c),
        Code::KeyW => Some(0x0d),
        Code::KeyE => Some(0x0e),
        Code::KeyR => Some(0x0f),
        Code::KeyY => Some(0x10),
        Code::KeyT => Some(0x11),
        Code::Digit1 => Some(0x12),
        Code::Digit2 => Some(0x13),
        Code::Digit3 => Some(0x14),
        Code::Digit4 => Some(0x15),
        Code::Digit6 => Some(0x16),
        Code::Digit5 => Some(0x17),
        Code::Equal => Some(0x18),
        Code::Digit9 => Some(0x19),
        Code::Digit7 => Some(0x1a),
        Code::Minus => Some(0x1b),
        Code::Digit8 => Some(0x1c),
        Code::Digit0 => Some(0x1d),
        Code::BracketRight => Some(0x1e),
        Code::KeyO => Some(0x1f),
        Code::KeyU => Some(0x20),
        Code::BracketLeft => Some(0x21),
        Code::KeyI => Some(0x22),
        Code::KeyP => Some(0x23),
        Code::Enter => Some(0x24),
        Code::KeyL => Some(0x25),
        Code::KeyJ => Some(0x26),
        Code::Quote => Some(0x27),
        Code::KeyK => Some(0x28),
        Code::Semicolon => Some(0x29),
        Code::Backslash => Some(0x2a),
        Code::Comma => Some(0x2b),
        Code::Slash => Some(0x2c),
        Code::KeyN => Some(0x2d),
        Code::KeyM => Some(0x2e),
        Code::Period => Some(0x2f),
        Code::Tab => Some(0x30),
        Code::Space => Some(0x31),
        Code::Backquote => Some(0x32),
        Code::Backspace => Some(0x33),
        Code::Escape => Some(0x35),
        Code::F17 => Some(0x40),
        Code::NumpadDecimal => Some(0x41),
        Code::NumpadMultiply => Some(0x43),
        Code::NumpadAdd => Some(0x45),
        Code::NumLock => Some(0x47),
        Code::AudioVolumeUp => Some(0x48),
        Code::AudioVolumeDown => Some(0x49),
        Code::AudioVolumeMute => Some(0x4a),
        Code::NumpadDivide => Some(0x4b),
        Code::NumpadEnter => Some(0x4c),
        Code::NumpadSubtract => Some(0x4e),
        Code::F18 => Some(0x4f),
        Code::F19 => Some(0x50),
        Code::NumpadEqual => Some(0x51),
        Code::Numpad0 => Some(0x52),
        Code::Numpad1 => Some(0x53),
        Code::Numpad2 => Some(0x54),
        Code::Numpad3 => Some(0x55),
        Code::Numpad4 => Some(0x56),
        Code::Numpad5 => Some(0x57),
        Code::Numpad6 => Some(0x58),
        Code::Numpad7 => Some(0x59),
        Code::F20 => Some(0x5a),
        Code::Numpad8 => Some(0x5b),
        Code::Numpad9 => Some(0x5c),
        Code::F5 => Some(0x60),
        Code::F6 => Some(0x61),
        Code::F7 => Some(0x62),
        Code::F3 => Some(0x63),
        Code::F8 => Some(0x64),
        Code::F9 => Some(0x65),
        Code::F11 => Some(0x67),
        Code::F13 => Some(0x69),
        Code::F16 => Some(0x6a),
        Code::F14 => Some(0x6b),
        Code::F10 => Some(0x6d),
        Code::F12 => Some(0x6f),
        Code::F15 => Some(0x71),
        Code::Insert => Some(0x72),
        Code::Home => Some(0x73),
        Code::PageUp => Some(0x74),
        Code::Delete => Some(0x75),
        Code::F4 => Some(0x76),
        Code::End => Some(0x77),
        Code::F2 => Some(0x78),
        Code::PageDown => Some(0x79),
        Code::F1 => Some(0x7a),
        Code::ArrowLeft => Some(0x7b),
        Code::ArrowRight => Some(0x7c),
        Code::ArrowDown => Some(0x7d),
        Code::ArrowUp => Some(0x7e),
        Code::CapsLock => Some(0x39),
        Code::PrintScreen => Some(0x46),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_hotkey_fixture_and_keeps_probe_outside_plugin_ids() {
        let key: Shortcut = "Control+Alt+Shift+F8".parse().unwrap();
        assert_eq!(key_to_scancode(key.key), Some(0x64));
        assert_eq!(carbon_modifiers(key.mods), 4096 | 2048 | 512);
        assert_eq!(
            carbon_modifiers(Modifiers::SUPER),
            carbon_modifiers(Modifiers::META)
        );
        assert_ne!(PROBE_ID, key.id());
        assert_eq!(key_to_scancode(Code::KeyA), Some(0));
        assert_eq!(key_to_scancode(Code::F20), Some(0x5a));
        assert_eq!(key_to_scancode(Code::F21), None);
    }
    #[test]
    fn detects_native_conflict_without_cleanup_and_requires_successful_release() {
        let key: Shortcut = "Control+Alt+Shift+F8".parse().unwrap();
        let failed = AtomicBool::new(false);
        let occupied = probe_registration::<()>(
            key,
            &failed,
            || Err(HOTKEY_EXISTS),
            |_| panic!("no registration to release"),
        );
        assert!(occupied.unwrap_err().contains("已被占用"));
        assert!(!failed.load(Ordering::Acquire));
        let mut released = None;
        probe_registration(
            key,
            &failed,
            || Ok(7),
            |reference| {
                released = Some(reference);
                0
            },
        )
        .unwrap();
        assert_eq!(released, Some(7));
        let cleanup = probe_registration(key, &failed, || Ok(8), |_| -50);
        assert!(cleanup.unwrap_err().contains("未能释放"));
        assert!(failed.load(Ordering::Acquire));
        assert!(probe_registration::<()>(
            key,
            &failed,
            || panic!("cleanup failure must block subsequent probes"),
            |_| 0
        )
        .unwrap_err()
        .contains("重新打开"));
    }
}
