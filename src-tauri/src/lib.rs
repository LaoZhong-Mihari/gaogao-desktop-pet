use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuBuilder, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const PET_WINDOW: &str = "pet";
const SETTINGS_WINDOW: &str = "settings";
const WINDOW_LABELS: [&str; 2] = [PET_WINDOW, SETTINGS_WINDOW];

const FOOD_TOKEN_FILENAME: &str = "糕糕的猫条（拖给糕糕）.png";
const FOOD_TOKEN_MARKER_FILENAME: &str = "food-token-created-v1";
const FOOD_TOKEN_BYTES: &[u8] = include_bytes!("../../public/assets/food-token.png");

const MENU_TOGGLE_PET: &str = "toggle-pet";
const MENU_PAUSE: &str = "pause-resume";
const MENU_GROOMING: &str = "grooming";
const MENU_FOOD_TOKEN: &str = "food-token";
const MENU_RESET_GROWTH: &str = "reset-growth";
const MENU_ALWAYS_ON_TOP: &str = "always-on-top";
const MENU_LAUNCH_AT_LOGIN: &str = "launch-at-login";
const MENU_SETTINGS: &str = "settings";
const MENU_QUIT: &str = "quit";

const EVENT_PAUSE_CHANGED: &str = "tray://pause-changed";
const EVENT_GROOMING: &str = "tray://grooming";
const EVENT_RESET_GROWTH: &str = "tray://reset-growth";
const EVENT_ALWAYS_ON_TOP_CHANGED: &str = "tray://always-on-top-changed";
const EVENT_LAUNCH_AT_LOGIN_CHANGED: &str = "tray://launch-at-login-changed";
const EVENT_VISIBILITY_CHANGED: &str = "tray://visibility-changed";

struct NativeState {
    paused: AtomicBool,
    always_on_top: AtomicBool,
    launch_at_login: AtomicBool,
    pet_drag: Mutex<Option<PetDragSession>>,
    tray_toggle_pet: MenuItem<Wry>,
    tray_pause: MenuItem<Wry>,
    tray_reset_growth: MenuItem<Wry>,
    tray_always_on_top: CheckMenuItem<Wry>,
    tray_launch_at_login: CheckMenuItem<Wry>,
    pet_toggle_pet: MenuItem<Wry>,
    pet_pause: MenuItem<Wry>,
    pet_reset_growth: MenuItem<Wry>,
    pet_menu: Menu<Wry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GlobalPointerState {
    /// Desktop coordinates expressed in the caller window's physical scale.
    x: f64,
    y: f64,
    primary_button_pressed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct DragPoint {
    x: f64,
    y: f64,
}

#[derive(Debug)]
struct PetDragSession {
    pointer_id: i64,
    start_cursor: DragPoint,
    start_window: DragPoint,
    last_cursor: DragPoint,
    moved: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PetDragMotion {
    target: DragPoint,
    total_delta_x: f64,
    total_delta_y: f64,
    movement_x: f64,
    moved: bool,
}

impl PetDragSession {
    fn new(pointer_id: i64, cursor: DragPoint, window: DragPoint) -> Self {
        Self {
            pointer_id,
            start_cursor: cursor,
            start_window: window,
            last_cursor: cursor,
            moved: false,
        }
    }

    fn advance(&mut self, cursor: DragPoint, threshold: f64) -> PetDragMotion {
        let total_delta_x = cursor.x - self.start_cursor.x;
        let total_delta_y = cursor.y - self.start_cursor.y;
        let movement_x = cursor.x - self.last_cursor.x;
        self.moved = self.moved || total_delta_x.hypot(total_delta_y) >= threshold;
        self.last_cursor = cursor;
        PetDragMotion {
            target: DragPoint {
                x: self.start_window.x + total_delta_x,
                y: self.start_window.y + total_delta_y,
            },
            total_delta_x,
            total_delta_y,
            movement_x,
            moved: self.moved,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PetDragUpdate {
    total_delta_x: f64,
    total_delta_y: f64,
    movement_x: f64,
    moved: bool,
    geometry: WindowGeometry,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PetDragEnd {
    moved: bool,
    geometry: WindowGeometry,
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
}

#[cfg(target_os = "macos")]
fn primary_pointer_button_pressed() -> bool {
    const COMBINED_SESSION_STATE: i32 = 0;
    const LEFT_MOUSE_BUTTON: u32 = 0;
    // SAFETY: CoreGraphics exposes this process-independent read-only query on
    // every supported macOS version and accepts the constants above.
    unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, LEFT_MOUSE_BUTTON) }
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(virtual_key: i32) -> i16;
    fn GetSystemMetrics(index: i32) -> i32;
}

#[cfg(target_os = "windows")]
fn primary_pointer_button_pressed() -> bool {
    const SM_SWAPBUTTON: i32 = 23;
    const VK_LBUTTON: i32 = 0x01;
    const VK_RBUTTON: i32 = 0x02;
    // SAFETY: Both user32 calls are read-only process-independent queries.
    let primary_key = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } == 0 {
        VK_LBUTTON
    } else {
        VK_RBUTTON
    };
    (unsafe { GetAsyncKeyState(primary_key) } as u16 & 0x8000) != 0
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn primary_pointer_button_pressed() -> bool {
    false
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhysicalRectDto {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowGeometry {
    label: String,
    /// Every position and size in this DTO uses physical pixels.
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
    monitor_name: Option<String>,
    work_area: Option<PhysicalRectDto>,
}

fn command_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn validate_food_token_path(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() != FOOD_TOKEN_BYTES.len() as u64 {
        return false;
    }

    fs::read(path)
        .map(|bytes| bytes.as_slice() == FOOD_TOKEN_BYTES)
        .unwrap_or(false)
}

fn record_food_token_creation(marker: &Path) -> Result<(), String> {
    let parent = marker
        .parent()
        .ok_or_else(|| "food-token marker has no parent directory".to_owned())?;
    fs::create_dir_all(parent).map_err(command_error)?;
    fs::write(marker, b"created\n").map_err(command_error)
}

fn write_food_token(target: &Path) -> Result<(), String> {
    let mut file = match OpenOptions::new().write(true).create_new(true).open(target) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            if validate_food_token_path(target) {
                return Ok(());
            }
            return Err(format!(
                "桌面已有同名文件，糕糕不会覆盖它：{}",
                target.display()
            ));
        }
        Err(error) => return Err(command_error(error)),
    };

    if let Err(error) = file.write_all(FOOD_TOKEN_BYTES) {
        drop(file);
        let _ = fs::remove_file(target);
        return Err(command_error(error));
    }
    Ok(())
}

fn ensure_food_token_at(
    desktop: &Path,
    marker: &Path,
    respect_first_run_marker: bool,
) -> Result<PathBuf, String> {
    let target = desktop.join(FOOD_TOKEN_FILENAME);
    if respect_first_run_marker && marker.is_file() {
        return Ok(target);
    }

    write_food_token(&target)?;
    record_food_token_creation(marker)?;
    Ok(target)
}

fn ensure_food_token_impl(
    app: &AppHandle,
    respect_first_run_marker: bool,
) -> Result<PathBuf, String> {
    let desktop = app.path().desktop_dir().map_err(command_error)?;
    let marker = app
        .path()
        .app_data_dir()
        .map_err(command_error)?
        .join(FOOD_TOKEN_MARKER_FILENAME);
    ensure_food_token_at(&desktop, &marker, respect_first_run_marker)
}

fn resolve_window(
    app: &AppHandle,
    caller: &WebviewWindow,
    label: Option<&str>,
) -> Result<WebviewWindow, String> {
    let label = label.unwrap_or_else(|| caller.label());
    if !WINDOW_LABELS.contains(&label) {
        return Err(format!("unknown application window: {label}"));
    }

    app.get_webview_window(label)
        .ok_or_else(|| format!("window is not available: {label}"))
}

fn geometry_for(window: &WebviewWindow) -> Result<WindowGeometry, String> {
    let position = window.outer_position().map_err(command_error)?;
    let size = window.outer_size().map_err(command_error)?;
    let scale_factor = window.scale_factor().map_err(command_error)?;
    let monitor = match window.current_monitor().map_err(command_error)? {
        Some(monitor) => Some(monitor),
        None => window.primary_monitor().map_err(command_error)?,
    };

    let (monitor_name, work_area) = if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        (
            monitor.name().cloned(),
            Some(PhysicalRectDto {
                x: work_area.position.x,
                y: work_area.position.y,
                width: work_area.size.width,
                height: work_area.size.height,
            }),
        )
    } else {
        (None, None)
    };

    Ok(WindowGeometry {
        label: window.label().to_owned(),
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        scale_factor,
        monitor_name,
        work_area,
    })
}

fn cursor_position_for_window(
    app: &AppHandle,
    window: &WebviewWindow,
) -> Result<tauri::PhysicalPosition<f64>, String> {
    let mut position = app.cursor_position().map_err(command_error)?;

    // Tao reports the macOS global cursor using the primary monitor's scale,
    // while a window position uses the scale of the monitor containing that
    // window. Convert the cursor into that same coordinate basis so mixed-DPI
    // and negative-coordinate displays still produce the correct gaze vector.
    #[cfg(target_os = "macos")]
    {
        let primary_scale = app
            .primary_monitor()
            .map_err(command_error)?
            .map(|monitor| monitor.scale_factor())
            .unwrap_or(1.0);
        let window_scale = window.scale_factor().map_err(command_error)?;
        if primary_scale.is_finite() && primary_scale > 0.0 {
            let ratio = window_scale / primary_scale;
            position.x *= ratio;
            position.y *= ratio;
        }
    }

    Ok(position)
}

fn logical_drag_point(x: f64, y: f64, scale: f64) -> Result<DragPoint, String> {
    if !x.is_finite() || !y.is_finite() {
        return Err("pet drag coordinates must be finite".to_owned());
    }
    if !scale.is_finite() || scale <= 0.0 {
        return Err("pet drag scale must be finite and positive".to_owned());
    }
    Ok(DragPoint {
        x: x / scale,
        y: y / scale,
    })
}

#[cfg(target_os = "macos")]
fn pet_drag_cursor_position(app: &AppHandle) -> Result<DragPoint, String> {
    let position = app.cursor_position().map_err(command_error)?;
    let primary_scale = app
        .primary_monitor()
        .map_err(command_error)?
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);
    logical_drag_point(position.x, position.y, primary_scale)
}

#[cfg(not(target_os = "macos"))]
fn pet_drag_cursor_position(app: &AppHandle) -> Result<DragPoint, String> {
    let position = app.cursor_position().map_err(command_error)?;
    logical_drag_point(position.x, position.y, 1.0)
}

#[cfg(target_os = "macos")]
fn pet_drag_window_position(window: &WebviewWindow) -> Result<DragPoint, String> {
    let position = window.outer_position().map_err(command_error)?;
    let scale = window.scale_factor().map_err(command_error)?;
    logical_drag_point(position.x as f64, position.y as f64, scale)
}

#[cfg(not(target_os = "macos"))]
fn pet_drag_window_position(window: &WebviewWindow) -> Result<DragPoint, String> {
    let position = window.outer_position().map_err(command_error)?;
    logical_drag_point(position.x as f64, position.y as f64, 1.0)
}

#[cfg(target_os = "macos")]
fn apply_pet_drag_position(window: &WebviewWindow, point: DragPoint) -> Result<(), String> {
    if !point.x.is_finite() || !point.y.is_finite() {
        return Err("pet drag target must be finite".to_owned());
    }
    window
        .set_position(tauri::LogicalPosition::new(point.x, point.y))
        .map_err(command_error)
}

#[cfg(not(target_os = "macos"))]
fn apply_pet_drag_position(window: &WebviewWindow, point: DragPoint) -> Result<(), String> {
    let x = checked_coordinate(point.x, "x")?;
    let y = checked_coordinate(point.y, "y")?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(command_error)
}

fn checked_dimension(value: f64, name: &str) -> Result<u32, String> {
    if !value.is_finite() || value < 1.0 || value > u32::MAX as f64 {
        return Err(format!(
            "{name} must be a finite positive physical-pixel value"
        ));
    }
    Ok(value.round() as u32)
}

fn checked_coordinate(value: f64, name: &str) -> Result<i32, String> {
    if !value.is_finite() || value < i32::MIN as f64 || value > i32::MAX as f64 {
        return Err(format!("{name} must be a finite physical-pixel coordinate"));
    }
    Ok(value.round() as i32)
}

fn show_settings_impl(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(SETTINGS_WINDOW)
        .ok_or_else(|| "settings window is not available".to_owned())?;
    if window.is_minimized().map_err(command_error)? {
        window.unminimize().map_err(command_error)?;
    }
    window.show().map_err(command_error)?;
    window.set_focus().map_err(command_error)
}

fn set_pet_visible_impl(
    app: &AppHandle,
    state: &NativeState,
    visible: bool,
) -> Result<bool, String> {
    let pet = app
        .get_webview_window(PET_WINDOW)
        .ok_or_else(|| "pet window is not available".to_owned())?;

    if visible {
        pet.show().map_err(command_error)?;
    } else {
        pet.hide().map_err(command_error)?;
    }

    let text = if visible {
        "隐藏糕糕"
    } else {
        "显示糕糕"
    };
    let _ = state.tray_toggle_pet.set_text(text);
    let _ = state.pet_toggle_pet.set_text(text);
    let _ = app.emit(EVENT_VISIBILITY_CHANGED, visible);
    Ok(visible)
}

fn set_paused_impl(app: &AppHandle, state: &NativeState, paused: bool) -> bool {
    state.paused.store(paused, Ordering::Relaxed);
    let text = if paused {
        "继续活动"
    } else {
        "暂停活动"
    };
    let _ = state.tray_pause.set_text(text);
    let _ = state.pet_pause.set_text(text);
    let _ = app.emit(EVENT_PAUSE_CHANGED, paused);
    paused
}

fn set_always_on_top_impl(
    app: &AppHandle,
    state: &NativeState,
    enabled: bool,
) -> Result<bool, String> {
    let window = app
        .get_webview_window(PET_WINDOW)
        .ok_or_else(|| format!("window is not available: {PET_WINDOW}"))?;
    window.set_always_on_top(enabled).map_err(command_error)?;

    state.always_on_top.store(enabled, Ordering::Relaxed);
    let _ = state.tray_always_on_top.set_checked(enabled);
    let _ = app.emit(EVENT_ALWAYS_ON_TOP_CHANGED, enabled);
    Ok(enabled)
}

fn set_launch_at_login_impl(
    app: &AppHandle,
    state: &NativeState,
    enabled: bool,
) -> Result<bool, String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(command_error)?;
    } else {
        manager.disable().map_err(command_error)?;
    }

    let actual = manager.is_enabled().map_err(command_error)?;
    state.launch_at_login.store(actual, Ordering::Relaxed);
    let _ = state.tray_launch_at_login.set_checked(actual);
    let _ = app.emit(EVENT_LAUNCH_AT_LOGIN_CHANGED, actual);
    Ok(actual)
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    let state = app.state::<NativeState>();
    let result = match id {
        MENU_TOGGLE_PET => app
            .get_webview_window(PET_WINDOW)
            .ok_or_else(|| "pet window is not available".to_owned())
            .and_then(|window| window.is_visible().map_err(command_error))
            .and_then(|visible| set_pet_visible_impl(app, &state, !visible).map(|_| ())),
        MENU_PAUSE => {
            let paused = !state.paused.load(Ordering::Relaxed);
            set_paused_impl(app, &state, paused);
            Ok(())
        }
        MENU_GROOMING => {
            let _ = set_pet_visible_impl(app, &state, true);
            app.emit(EVENT_GROOMING, ()).map_err(command_error)
        }
        MENU_FOOD_TOKEN => ensure_food_token_impl(app, false).map(|_| ()),
        MENU_RESET_GROWTH => app.emit(EVENT_RESET_GROWTH, ()).map_err(command_error),
        MENU_ALWAYS_ON_TOP => {
            let enabled = !state.always_on_top.load(Ordering::Relaxed);
            set_always_on_top_impl(app, &state, enabled).map(|_| ())
        }
        MENU_LAUNCH_AT_LOGIN => {
            let enabled = !state.launch_at_login.load(Ordering::Relaxed);
            set_launch_at_login_impl(app, &state, enabled).map(|_| ())
        }
        MENU_SETTINGS => show_settings_impl(app),
        MENU_QUIT => {
            app.exit(0);
            Ok(())
        }
        _ => Ok(()),
    };

    if let Err(error) = result {
        eprintln!("menu action {id} failed: {error}");
    }
}

fn install_menus_and_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let launch_at_login = app.autolaunch().is_enabled().unwrap_or(false);

    let tray_toggle_pet = MenuItem::with_id(app, MENU_TOGGLE_PET, "隐藏糕糕", true, None::<&str>)?;
    let tray_pause = MenuItem::with_id(app, MENU_PAUSE, "暂停活动", true, None::<&str>)?;
    let tray_grooming = MenuItem::with_id(app, MENU_GROOMING, "颓废舔毛", true, None::<&str>)?;
    let tray_food_token =
        MenuItem::with_id(app, MENU_FOOD_TOKEN, "把猫条放回桌面", true, None::<&str>)?;
    let tray_reset_growth =
        MenuItem::with_id(app, MENU_RESET_GROWTH, "恢复原大小", false, None::<&str>)?;
    let tray_always_on_top = CheckMenuItem::with_id(
        app,
        MENU_ALWAYS_ON_TOP,
        "始终置顶",
        true,
        true,
        None::<&str>,
    )?;
    let tray_launch_at_login = CheckMenuItem::with_id(
        app,
        MENU_LAUNCH_AT_LOGIN,
        "开机启动",
        true,
        launch_at_login,
        None::<&str>,
    )?;
    let tray_settings = MenuItem::with_id(app, MENU_SETTINGS, "设置…", true, None::<&str>)?;
    let tray_quit = MenuItem::with_id(app, MENU_QUIT, "退出糕糕", true, None::<&str>)?;

    let tray_menu = MenuBuilder::new(app)
        .item(&tray_toggle_pet)
        .item(&tray_pause)
        .item(&tray_grooming)
        .item(&tray_food_token)
        .item(&tray_reset_growth)
        .separator()
        .item(&tray_always_on_top)
        .item(&tray_launch_at_login)
        .item(&tray_settings)
        .separator()
        .item(&tray_quit)
        .build()?;

    let pet_grooming = MenuItem::with_id(app, MENU_GROOMING, "颓废舔毛", true, None::<&str>)?;
    let pet_pause = MenuItem::with_id(app, MENU_PAUSE, "暂停活动", true, None::<&str>)?;
    let pet_reset_growth =
        MenuItem::with_id(app, MENU_RESET_GROWTH, "恢复原大小", false, None::<&str>)?;
    let pet_settings = MenuItem::with_id(app, MENU_SETTINGS, "设置…", true, None::<&str>)?;
    let pet_toggle_pet = MenuItem::with_id(app, MENU_TOGGLE_PET, "隐藏糕糕", true, None::<&str>)?;
    let pet_quit = MenuItem::with_id(app, MENU_QUIT, "退出糕糕", true, None::<&str>)?;
    let pet_menu = MenuBuilder::new(app)
        .item(&pet_grooming)
        .item(&pet_pause)
        .item(&pet_reset_growth)
        .item(&pet_settings)
        .separator()
        .item(&pet_toggle_pet)
        .item(&pet_quit)
        .build()?;

    let mut tray = TrayIconBuilder::with_id("gaogao-tray")
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .tooltip("糕糕桌宠");
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    app.manage(NativeState {
        paused: AtomicBool::new(false),
        always_on_top: AtomicBool::new(true),
        launch_at_login: AtomicBool::new(launch_at_login),
        pet_drag: Mutex::new(None),
        tray_toggle_pet,
        tray_pause,
        tray_reset_growth,
        tray_always_on_top,
        tray_launch_at_login,
        pet_toggle_pet,
        pet_pause,
        pet_reset_growth,
        pet_menu,
    });

    Ok(())
}

#[tauri::command]
fn get_global_pointer_state(
    app: AppHandle,
    window: WebviewWindow,
    label: Option<String>,
) -> Result<GlobalPointerState, String> {
    let target = resolve_window(&app, &window, label.as_deref())?;
    let position = cursor_position_for_window(&app, &target)?;
    Ok(GlobalPointerState {
        x: position.x,
        y: position.y,
        primary_button_pressed: primary_pointer_button_pressed(),
    })
}

#[tauri::command]
fn begin_pet_drag(
    app: AppHandle,
    window: WebviewWindow,
    state: State<NativeState>,
    pointer_id: i64,
) -> Result<(), String> {
    let target = resolve_window(&app, &window, Some(PET_WINDOW))?;
    let cursor = pet_drag_cursor_position(&app)?;
    let window_position = pet_drag_window_position(&target)?;
    let mut active = state
        .pet_drag
        .lock()
        .map_err(|_| "pet drag state is unavailable".to_owned())?;
    *active = Some(PetDragSession::new(pointer_id, cursor, window_position));
    Ok(())
}

#[tauri::command]
fn update_pet_drag(
    app: AppHandle,
    window: WebviewWindow,
    state: State<NativeState>,
    pointer_id: i64,
    threshold: f64,
) -> Result<PetDragUpdate, String> {
    if !threshold.is_finite() || threshold < 0.0 {
        return Err("pet drag threshold must be finite and non-negative".to_owned());
    }
    let target = resolve_window(&app, &window, Some(PET_WINDOW))?;
    let (motion, geometry) = {
        let mut active = state
            .pet_drag
            .lock()
            .map_err(|_| "pet drag state is unavailable".to_owned())?;
        let session = active
            .as_mut()
            .ok_or_else(|| "pet drag is not active".to_owned())?;
        if session.pointer_id != pointer_id {
            return Err("pet drag pointer does not match the active session".to_owned());
        }
        let cursor = pet_drag_cursor_position(&app)?;
        let motion = session.advance(cursor, threshold);
        if motion.moved {
            apply_pet_drag_position(&target, motion.target)?;
        }
        (motion, geometry_for(&target)?)
    };
    Ok(PetDragUpdate {
        total_delta_x: motion.total_delta_x,
        total_delta_y: motion.total_delta_y,
        movement_x: motion.movement_x,
        moved: motion.moved,
        geometry,
    })
}

#[tauri::command]
fn end_pet_drag(
    app: AppHandle,
    window: WebviewWindow,
    state: State<NativeState>,
    pointer_id: i64,
) -> Result<PetDragEnd, String> {
    let target = resolve_window(&app, &window, Some(PET_WINDOW))?;
    let mut active = state
        .pet_drag
        .lock()
        .map_err(|_| "pet drag state is unavailable".to_owned())?;
    let moved = active
        .as_ref()
        .filter(|session| session.pointer_id == pointer_id)
        .is_some_and(|session| session.moved);
    if active
        .as_ref()
        .is_some_and(|session| session.pointer_id == pointer_id)
    {
        *active = None;
    }
    drop(active);
    Ok(PetDragEnd {
        moved,
        geometry: geometry_for(&target)?,
    })
}

#[tauri::command]
fn get_window_geometry(
    app: AppHandle,
    window: WebviewWindow,
    label: Option<String>,
) -> Result<WindowGeometry, String> {
    let target = resolve_window(&app, &window, label.as_deref())?;
    geometry_for(&target)
}

/// Moves an application window using desktop-relative physical pixels.
#[tauri::command]
fn move_window(
    app: AppHandle,
    window: WebviewWindow,
    label: Option<String>,
    x: f64,
    y: f64,
) -> Result<WindowGeometry, String> {
    let target = resolve_window(&app, &window, label.as_deref())?;
    let x = checked_coordinate(x, "x")?;
    let y = checked_coordinate(y, "y")?;
    target
        .set_position(PhysicalPosition::new(x, y))
        .map_err(command_error)?;
    geometry_for(&target)
}

/// Resizes an application window using physical pixels.
#[tauri::command]
fn resize_window(
    app: AppHandle,
    window: WebviewWindow,
    label: Option<String>,
    width: f64,
    height: f64,
) -> Result<WindowGeometry, String> {
    let target = resolve_window(&app, &window, label.as_deref())?;
    let width = checked_dimension(width, "width")?;
    let height = checked_dimension(height, "height")?;
    target
        .set_size(PhysicalSize::new(width, height))
        .map_err(command_error)?;
    geometry_for(&target)
}

#[tauri::command]
fn ensure_food_token(app: AppHandle) -> Result<String, String> {
    ensure_food_token_impl(&app, false).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn validate_food_token(path: String) -> bool {
    validate_food_token_path(Path::new(&path))
}

#[tauri::command]
fn show_settings(app: AppHandle) -> Result<(), String> {
    show_settings_impl(&app)
}

#[tauri::command]
fn hide_settings(app: AppHandle) -> Result<(), String> {
    app.get_webview_window(SETTINGS_WINDOW)
        .ok_or_else(|| "settings window is not available".to_owned())?
        .hide()
        .map_err(command_error)
}

#[tauri::command]
fn set_pet_visible(
    app: AppHandle,
    state: State<NativeState>,
    visible: bool,
) -> Result<bool, String> {
    set_pet_visible_impl(&app, &state, visible)
}

#[tauri::command]
fn get_pet_visible(app: AppHandle) -> Result<bool, String> {
    app.get_webview_window(PET_WINDOW)
        .ok_or_else(|| "pet window is not available".to_owned())?
        .is_visible()
        .map_err(command_error)
}

#[tauri::command]
fn set_ignore_cursor_events(
    app: AppHandle,
    window: WebviewWindow,
    label: Option<String>,
    ignore: bool,
) -> Result<(), String> {
    resolve_window(&app, &window, label.as_deref())?
        .set_ignore_cursor_events(ignore)
        .map_err(command_error)
}

#[tauri::command]
fn set_always_on_top(
    app: AppHandle,
    state: State<NativeState>,
    enabled: bool,
) -> Result<bool, String> {
    set_always_on_top_impl(&app, &state, enabled)
}

#[tauri::command]
fn get_always_on_top(state: State<NativeState>) -> bool {
    state.always_on_top.load(Ordering::Relaxed)
}

#[tauri::command]
fn toggle_always_on_top(app: AppHandle, state: State<NativeState>) -> Result<bool, String> {
    let enabled = !state.always_on_top.load(Ordering::Relaxed);
    set_always_on_top_impl(&app, &state, enabled)
}

#[tauri::command]
fn set_launch_at_login(
    app: AppHandle,
    state: State<NativeState>,
    enabled: bool,
) -> Result<bool, String> {
    set_launch_at_login_impl(&app, &state, enabled)
}

#[tauri::command]
fn get_launch_at_login(app: AppHandle, state: State<NativeState>) -> Result<bool, String> {
    let enabled = app.autolaunch().is_enabled().map_err(command_error)?;
    state.launch_at_login.store(enabled, Ordering::Relaxed);
    let _ = state.tray_launch_at_login.set_checked(enabled);
    Ok(enabled)
}

#[tauri::command]
fn toggle_launch_at_login(app: AppHandle, state: State<NativeState>) -> Result<bool, String> {
    let enabled = !app.autolaunch().is_enabled().map_err(command_error)?;
    set_launch_at_login_impl(&app, &state, enabled)
}

#[tauri::command]
fn set_paused(app: AppHandle, state: State<NativeState>, paused: bool) -> bool {
    set_paused_impl(&app, &state, paused)
}

#[tauri::command]
fn get_paused(state: State<NativeState>) -> bool {
    state.paused.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_growth_reset_enabled(state: State<NativeState>, enabled: bool) {
    let _ = state.tray_reset_growth.set_enabled(enabled);
    let _ = state.pet_reset_growth.set_enabled(enabled);
}

#[tauri::command]
fn show_pet_menu(window: WebviewWindow, state: State<NativeState>) -> Result<(), String> {
    if window.label() != PET_WINDOW {
        return Err("the native pet menu can only be shown by the pet window".to_owned());
    }
    window.popup_menu(&state.pet_menu).map_err(command_error)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The single-instance plugin intentionally stays first. Its callback restores
        // the existing pet instead of allowing a second tray process.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(state) = app.try_state::<NativeState>() {
                let _ = set_pet_visible_impl(app, &state, true);
            } else if let Some(pet) = app.get_webview_window(PET_WINDOW) {
                // This fallback only matters if another launch races the first setup.
                let _ = pet.show();
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Err(error) = ensure_food_token_impl(app.handle(), true) {
                // Desktop access can be denied independently of app startup. The
                // tray action lets the user retry later without making launch fail.
                eprintln!("initial food-token placement failed: {error}");
            }

            install_menus_and_tray(app)?;
            Ok(())
        })
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if WINDOW_LABELS.contains(&window.label()) {
                    api.prevent_close();
                    let app = window.app_handle();
                    if window.label() == PET_WINDOW {
                        let state = app.state::<NativeState>();
                        let _ = set_pet_visible_impl(app, &state, false);
                    } else {
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_global_pointer_state,
            begin_pet_drag,
            update_pet_drag,
            end_pet_drag,
            get_window_geometry,
            move_window,
            resize_window,
            ensure_food_token,
            validate_food_token,
            show_settings,
            hide_settings,
            set_pet_visible,
            get_pet_visible,
            set_ignore_cursor_events,
            set_always_on_top,
            get_always_on_top,
            toggle_always_on_top,
            set_launch_at_login,
            get_launch_at_login,
            toggle_launch_at_login,
            set_paused,
            get_paused,
            set_growth_reset_enabled,
            show_pet_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Gaogao desktop pet");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TempTree(PathBuf);

    impl TempTree {
        fn new(name: &str) -> Self {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "gaogao-desktop-pet-{name}-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn validates_only_the_complete_embedded_food_token() {
        let tree = TempTree::new("validate-food-token");
        let official = tree.0.join("official.png");
        fs::write(&official, FOOD_TOKEN_BYTES).expect("write official token");
        assert!(validate_food_token_path(&official));

        let mut altered = FOOD_TOKEN_BYTES.to_vec();
        assert!(!altered.is_empty());
        altered[0] ^= 0xff;
        let same_size_but_different = tree.0.join("different.png");
        fs::write(&same_size_but_different, altered).expect("write altered token");
        assert!(!validate_food_token_path(&same_size_but_different));

        let ordinary = tree.0.join("ordinary.txt");
        fs::write(&ordinary, b"not a cat treat").expect("write ordinary file");
        assert!(!validate_food_token_path(&ordinary));
        assert!(!validate_food_token_path(&tree.0));
    }

    #[test]
    fn first_run_marker_prevents_automatic_recreation_but_manual_retry_restores_it() {
        let tree = TempTree::new("first-run-marker");
        let desktop = tree.0.join("Desktop");
        let marker = tree.0.join("AppData").join(FOOD_TOKEN_MARKER_FILENAME);
        fs::create_dir_all(&desktop).expect("create desktop");

        let target = ensure_food_token_at(&desktop, &marker, true).expect("place first token");
        assert_eq!(target, desktop.join(FOOD_TOKEN_FILENAME));
        assert!(validate_food_token_path(&target));
        assert!(marker.is_file());

        fs::remove_file(&target).expect("remove desktop token");
        ensure_food_token_at(&desktop, &marker, true).expect("honor first-run marker");
        assert!(!target.exists());

        ensure_food_token_at(&desktop, &marker, false).expect("manual retry");
        assert!(validate_food_token_path(&target));
    }

    #[test]
    fn never_overwrites_a_different_same_name_file() {
        let tree = TempTree::new("no-overwrite");
        let desktop = tree.0.join("Desktop");
        let marker = tree.0.join("AppData").join(FOOD_TOKEN_MARKER_FILENAME);
        fs::create_dir_all(&desktop).expect("create desktop");
        let target = desktop.join(FOOD_TOKEN_FILENAME);
        fs::write(&target, b"user-owned contents").expect("write user file");

        let error = ensure_food_token_at(&desktop, &marker, false)
            .expect_err("different same-name file must not be overwritten");
        assert!(error.contains("不会覆盖"));
        assert_eq!(
            fs::read(&target).expect("read user file"),
            b"user-owned contents"
        );
        assert!(!marker.exists());
    }

    #[test]
    fn normalizes_drag_points_before_combining_cursor_and_window_positions() {
        assert_eq!(
            logical_drag_point(4_100.0, 1_600.0, 2.0).expect("primary-display cursor"),
            DragPoint {
                x: 2_050.0,
                y: 800.0,
            }
        );
        assert_eq!(
            logical_drag_point(2_000.0, 700.0, 1.0).expect("external-display window"),
            DragPoint {
                x: 2_000.0,
                y: 700.0,
            }
        );
        assert!(logical_drag_point(0.0, 0.0, 0.0).is_err());
    }

    #[test]
    fn pet_drag_motion_uses_one_stable_coordinate_space() {
        let mut session = PetDragSession::new(
            7,
            DragPoint {
                x: 2_050.0,
                y: 800.0,
            },
            DragPoint {
                x: 2_000.0,
                y: 700.0,
            },
        );
        let first = session.advance(
            DragPoint {
                x: 2_060.0,
                y: 806.0,
            },
            5.0,
        );
        assert_eq!(first.total_delta_x, 10.0);
        assert_eq!(first.total_delta_y, 6.0);
        assert_eq!(first.movement_x, 10.0);
        assert!(first.moved);
        assert_eq!(
            first.target,
            DragPoint {
                x: 2_010.0,
                y: 706.0,
            }
        );

        let second = session.advance(
            DragPoint {
                x: 2_057.0,
                y: 810.0,
            },
            5.0,
        );
        assert_eq!(second.total_delta_x, 7.0);
        assert_eq!(second.total_delta_y, 10.0);
        assert_eq!(second.movement_x, -3.0);
        assert!(second.moved);
        assert_eq!(
            second.target,
            DragPoint {
                x: 2_007.0,
                y: 710.0,
            }
        );
    }

    #[test]
    fn pet_drag_does_not_move_the_window_before_the_threshold() {
        let mut session = PetDragSession::new(
            3,
            DragPoint { x: 100.0, y: 200.0 },
            DragPoint { x: 400.0, y: 500.0 },
        );
        let jitter = session.advance(DragPoint { x: 103.0, y: 204.0 }, 6.0);
        assert!(!jitter.moved);
        let started = session.advance(DragPoint { x: 106.0, y: 200.0 }, 6.0);
        assert!(started.moved);
        let continued = session.advance(DragPoint { x: 104.0, y: 200.0 }, 6.0);
        assert!(continued.moved);
    }
}
