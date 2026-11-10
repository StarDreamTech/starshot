use crate::scrolling::ScrollDirection;
use crate::window_regions::WindowBounds;

pub(crate) fn same_target(expected: WindowBounds, current: WindowBounds) -> bool {
    let mut current = current;
    if let (Some(expected), Some(current)) = (expected.native, current.native.as_mut()) {
        current.z_order = expected.z_order;
    }
    expected == current
}

pub(crate) fn target_at(windows: &[WindowBounds], point: (i32, i32)) -> Option<WindowBounds> {
    windows.iter().copied().find(|window| {
        i64::from(point.0) >= i64::from(window.x)
            && i64::from(point.1) >= i64::from(window.y)
            && i64::from(point.0) < i64::from(window.x) + i64::from(window.width)
            && i64::from(point.1) < i64::from(window.y) + i64::from(window.height)
    })
}

#[cfg(target_os = "macos")]
pub(crate) fn scroll_down(
    target: WindowBounds,
    point: (i32, i32),
    distance: u32,
    direction: ScrollDirection,
    reverse: bool,
) -> Result<(), String> {
    use std::ffi::c_void;
    #[repr(C)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightPostEventAccess() -> bool;
        fn CGEventCreateScrollWheelEvent2(
            source: *const c_void,
            units: u32,
            wheels: u32,
            vertical: i32,
            horizontal: i32,
            depth: i32,
        ) -> *const c_void;
        fn CGEventSetLocation(event: *const c_void, point: Point);
        fn CGEventSetFlags(event: *const c_void, flags: u64);
        fn CGEventPost(tap: u32, event: *const c_void);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: *const c_void);
    }
    let windows = crate::window_regions::snapshot(std::process::id())?;
    if !target_at(&windows, point).is_some_and(|current| same_target(target, current)) {
        return Err("原页面已移动、关闭或被遮挡，已暂停自动滚动".into());
    }
    unsafe {
        if !CGPreflightPostEventAccess() {
            return Err("自动滚动需要已有的辅助功能权限；也可自行滚动后手动采集。".into());
        }
        let delta = distance.clamp(1, 240) as i32 * if reverse { 1 } else { -1 };
        let event = CGEventCreateScrollWheelEvent2(
            std::ptr::null(),
            0,
            2,
            if direction == ScrollDirection::Vertical {
                delta
            } else {
                0
            },
            if direction == ScrollDirection::Horizontal {
                delta
            } else {
                0
            },
            0,
        );
        if event.is_null() {
            return Err("无法创建滚动事件，已保留长图".into());
        }
        CGEventSetLocation(
            event,
            Point {
                x: f64::from(point.0),
                y: f64::from(point.1),
            },
        );
        CGEventSetFlags(event, 0);
        CGEventPost(0, event);
        CFRelease(event);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn scroll_down(
    target: WindowBounds,
    point: (i32, i32),
    _distance: u32,
    direction: ScrollDirection,
    reverse: bool,
) -> Result<(), String> {
    use windows::Win32::{
        Foundation::{HWND, LPARAM, POINT, WPARAM},
        UI::{
            HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
            WindowsAndMessaging::{
                GetAncestor, SendMessageTimeoutW, WindowFromPoint, GA_ROOT, SMTO_ABORTIFHUNG,
                WM_MOUSEHWHEEL, WM_MOUSEWHEEL,
            },
        },
    };
    let identity = target.native.ok_or("无法核实原页面身份，请使用手动采集")?;
    if point.0 < i16::MIN as i32
        || point.0 > i16::MAX as i32
        || point.1 < i16::MIN as i32
        || point.1 > i16::MAX as i32
    {
        return Err("此显示器坐标超出自动滚动范围，请使用手动采集".into());
    }
    unsafe {
        let previous = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let result = (|| {
            let child = WindowFromPoint(POINT {
                x: point.0,
                y: point.1,
            });
            if child.0.is_null()
                || GetAncestor(child, GA_ROOT) != HWND(identity.hwnd as *mut _)
                || !crate::window_regions::windows::valid(target)
            {
                return Err("原页面已移动、关闭或被遮挡，已暂停自动滚动".into());
            }
            let packed = (point.0 as u16 as u32) | ((point.1 as u16 as u32) << 16);
            let result = SendMessageTimeoutW(
                child,
                if direction == ScrollDirection::Horizontal {
                    WM_MOUSEHWHEEL
                } else {
                    WM_MOUSEWHEEL
                },
                WPARAM(
                    (((if direction == ScrollDirection::Horizontal {
                        120_i16
                    } else {
                        -120_i16
                    }) * if reverse { -1 } else { 1 }) as u16 as usize)
                        << 16,
                ),
                LPARAM(packed as isize),
                SMTO_ABORTIFHUNG,
                250,
                None,
            );
            if result.0 == 0 {
                return Err("原页面未接受滚动或响应超时，请使用手动采集".into());
            }
            Ok(())
        })();
        if !previous.0.is_null() {
            SetThreadDpiAwarenessContext(previous);
        }
        result
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn scroll_down(
    _target: WindowBounds,
    _point: (i32, i32),
    _distance: u32,
    _direction: ScrollDirection,
    _reverse: bool,
) -> Result<(), String> {
    Err("此平台请使用手动逐屏采集".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::window_regions::NativeWindow;

    #[test]
    fn target_is_frontmost_half_open_and_keeps_native_identity() {
        let original = WindowBounds {
            pid: 42,
            x: -500,
            y: -200,
            width: 400,
            height: 300,
            native: Some(NativeWindow {
                hwnd: 12,
                thread_id: 5,
                process_started: 9,
                class_atom: 3,
                z_order: 2,
            }),
        };
        let mut changed = original;
        changed.native.as_mut().unwrap().z_order = 8;
        assert!(same_target(original, changed));
        changed.native.as_mut().unwrap().process_started += 1;
        assert!(!same_target(original, changed));
        assert!(!same_target(
            original,
            WindowBounds {
                x: -499,
                ..original
            }
        ));
        assert_eq!(target_at(&[original], (-100, 0)), None);
        assert_eq!(target_at(&[original], (-500, -200)), Some(original));
        assert_eq!(target_at(&[changed, original], (-400, 0)), Some(changed));
    }
}
