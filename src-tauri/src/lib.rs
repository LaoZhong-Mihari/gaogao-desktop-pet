use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
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
struct CursorPosition {
    /// Desktop-relative physical pixels.
    x: f64,
    /// Desktop-relative physical pixels.
    y: f64,
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
fn get_cursor_position(app: AppHandle) -> Result<CursorPosition, String> {
    let position = app.cursor_position().map_err(command_error)?;
    Ok(CursorPosition {
        x: position.x,
        y: position.y,
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
            get_cursor_position,
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
}
