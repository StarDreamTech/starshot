//! Temporary macOS screenshot presentation. Never changes system preferences.
//! Call begin/end on the AppKit main thread; one session may own several screens.

const AUTO_HIDE_DOCK: usize = 1 << 0;
const HIDE_DOCK: usize = 1 << 1;
const AUTO_HIDE_MENU_BAR: usize = 1 << 2;
const HIDE_MENU_BAR: usize = 1 << 3;
const AUTO_HIDE_TOOLBAR: usize = 1 << 11;
// NSApplication.h: available on macOS 27+, and requires hide/autoHideDock.
const DISABLE_SCREEN_CORNERS: usize = 1 << 15;

#[derive(Default)]
struct Presentation {
    original: Option<usize>,
}
impl Presentation {
    fn begin(&mut self, current: usize, screen_corners_available: bool) -> usize {
        let original = *self.original.get_or_insert(current);
        // HideMenuBar requires HideDock; clear mutually exclusive auto-hide bits.
        // AutoHideToolbar also requires AutoHideMenuBar, so it cannot be retained.
        (original & !(AUTO_HIDE_DOCK | AUTO_HIDE_MENU_BAR | AUTO_HIDE_TOOLBAR))
            | HIDE_DOCK
            | HIDE_MENU_BAR
            | if screen_corners_available {
                DISABLE_SCREEN_CORNERS
            } else {
                0
            }
    }
    fn end(&mut self) -> Option<usize> {
        self.original.take()
    }
}

#[cfg(all(feature = "desktop", target_os = "macos"))]
mod native {
    use super::Presentation;
    use objc2::{available, class, msg_send, rc::Retained, runtime::AnyObject, MainThreadMarker};
    use std::cell::RefCell;

    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const MOVE_TO_ACTIVE_SPACE: usize = 1 << 1;
    const MANAGED: usize = 1 << 2;
    const TRANSIENT: usize = 1 << 3;
    const STATIONARY: usize = 1 << 4;
    const PARTICIPATES_IN_CYCLE: usize = 1 << 5;
    const IGNORES_CYCLE: usize = 1 << 6;
    const FULL_SCREEN_PRIMARY: usize = 1 << 7;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
    const FULL_SCREEN_NONE: usize = 1 << 9;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }

    struct WindowState {
        window: Retained<AnyObject>,
        level: isize,
        behavior: usize,
    }
    #[derive(Default)]
    struct Session {
        presentation: Presentation,
        windows: Vec<WindowState>,
    }
    thread_local! {
        // NSWindow ownership and AppKit calls never leave the main thread.
        static SESSION: RefCell<Session> = RefCell::new(Session::default());
    }

    pub fn begin(window: &tauri::WebviewWindow) -> Result<(), String> {
        MainThreadMarker::new().ok_or("截图显示设置必须在主线程更新")?;
        let pointer = window.ns_window().map_err(|error| error.to_string())?;
        // Tauri owns this NSWindow. Retaining it until end also makes restoration
        // safe when a queued native destroy arrives before session cleanup.
        let window =
            unsafe { Retained::retain(pointer.cast::<AnyObject>()) }.ok_or("截图窗口已关闭")?;
        SESSION.with(|cell| {
            let mut session = cell.borrow_mut();
            let saved = session
                .windows
                .iter()
                .find(|saved| Retained::as_ptr(&saved.window) == Retained::as_ptr(&window));
            let behavior = if let Some(saved) = saved {
                saved.behavior
            } else {
                let level: isize = unsafe { msg_send![&*window, level] };
                let behavior: usize = unsafe { msg_send![&*window, collectionBehavior] };
                session.windows.push(WindowState {
                    window: window.clone(),
                    level,
                    behavior,
                });
                behavior
            };
            // Stationary keeps the frozen selection surface out of Exposé/Show
            // Desktop animations. This is a fallback on older macOS, not a claim
            // that every legacy hot-corner action can be disabled.
            let behavior = (behavior
                & !(MOVE_TO_ACTIVE_SPACE
                    | MANAGED
                    | TRANSIENT
                    | PARTICIPATES_IN_CYCLE
                    | FULL_SCREEN_PRIMARY
                    | FULL_SCREEN_NONE))
                | CAN_JOIN_ALL_SPACES
                | STATIONARY
                | IGNORES_CYCLE
                | FULL_SCREEN_AUXILIARY;
            unsafe {
                let _: () = msg_send![&*window, setCollectionBehavior: behavior];
                // Public CGWindowLevelKey::screenSaverWindow (13), above menu/Dock.
                let _: () = msg_send![&*window, setLevel: CGWindowLevelForKey(13) as isize];
                let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
                let current: usize = msg_send![app, presentationOptions];
                let options = session
                    .presentation
                    .begin(current, available!(macos = 27.0));
                let _: () = msg_send![app, setPresentationOptions: options];
            }
        });
        Ok(())
    }

    pub fn end() -> Result<(), String> {
        MainThreadMarker::new().ok_or("截图显示设置必须在主线程恢复")?;
        SESSION.with(|cell| {
            let mut session = cell.borrow_mut();
            for saved in session.windows.drain(..) {
                unsafe {
                    let _: () = msg_send![&*saved.window, setLevel: saved.level];
                    let _: () = msg_send![&*saved.window, setCollectionBehavior: saved.behavior];
                }
            }
            if let Some(original) = session.presentation.end() {
                unsafe {
                    let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
                    let _: () = msg_send![app, setPresentationOptions: original];
                }
            }
        });
        Ok(())
    }
}

#[cfg(all(feature = "desktop", target_os = "macos"))]
pub use native::{begin, end};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiple_screens_restore_the_first_presentation_and_allow_a_new_session() {
        // Existing fullscreen/toolbar options must be restored exactly, while
        // incompatible auto-hide combinations are absent during selection.
        let original = AUTO_HIDE_DOCK | AUTO_HIDE_MENU_BAR | AUTO_HIDE_TOOLBAR | (1 << 10);
        let mut presentation = Presentation::default();
        let capture = presentation.begin(original, true);
        assert_eq!(
            capture & (HIDE_DOCK | HIDE_MENU_BAR),
            HIDE_DOCK | HIDE_MENU_BAR
        );
        assert_ne!(capture & DISABLE_SCREEN_CORNERS, 0);
        assert_eq!(
            capture & (AUTO_HIDE_DOCK | AUTO_HIDE_MENU_BAR | AUTO_HIDE_TOOLBAR),
            0
        );
        assert_eq!(presentation.begin(capture, true), capture);
        assert_eq!(presentation.end(), Some(original));
        assert_eq!(presentation.end(), None);
        assert_eq!(presentation.begin(0, false), HIDE_DOCK | HIDE_MENU_BAR);
        assert_eq!(presentation.end(), Some(0));
    }
}
