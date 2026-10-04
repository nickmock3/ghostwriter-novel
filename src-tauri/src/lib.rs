pub mod sidecar;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, State};
use url::Url;

pub use sidecar::{
    bundled_sidecar_filename, select_health_check_origin, SidecarConnection, SidecarError,
    SidecarLaunch, SidecarProcess,
};

const READINESS_TIMEOUT: Duration = Duration::from_secs(30);
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const SIDECAR_STARTING_MESSAGE: &str = "ローカルAPIサーバーを起動しています。";

#[derive(Clone, Debug, Serialize)]
struct SidecarConnectionResponse {
    token: String,
    url: String,
}

struct SidecarLaunchConfig {
    allowed_origins: Vec<String>,
    data_root: PathBuf,
    health_origin: String,
    project_root: PathBuf,
    rg_executable: Option<PathBuf>,
    sidecar_executable: Option<PathBuf>,
}

struct SidecarRuntime {
    allowed_origins: Vec<String>,
    data_root: PathBuf,
    health_origin: String,
    launch_generation: u64,
    process: Option<SidecarProcess>,
    project_root: PathBuf,
    rg_executable: Option<PathBuf>,
    sidecar_executable: Option<PathBuf>,
    startup_error: Option<String>,
    startup_in_progress: bool,
}

pub struct SidecarState(Mutex<SidecarRuntime>);

impl SidecarState {
    fn lock_inner(&self) -> Result<std::sync::MutexGuard<'_, SidecarRuntime>, String> {
        self.0
            .lock()
            .map_err(|_| "sidecar state is unavailable".to_string())
    }
}

#[tauri::command]
fn get_sidecar_connection(
    state: State<'_, SidecarState>,
) -> Result<SidecarConnectionResponse, String> {
    let mut runtime = state.lock_inner()?;
    runtime.connection_response()
}

#[tauri::command]
fn restart_sidecar(state: State<'_, SidecarState>) -> Result<SidecarConnectionResponse, String> {
    let (generation, launch_config) = {
        let mut runtime = state.lock_inner()?;
        runtime.launch_generation += 1;
        runtime.startup_in_progress = true;
        runtime.startup_error = None;
        runtime
            .stop_sidecar()
            .map_err(|error| sanitize_sidecar_error(&error))?;
        (runtime.launch_generation, runtime.launch_config())
    };

    let result = start_sidecar_blocking(&launch_config);
    let mut runtime = state.lock_inner()?;
    if runtime.launch_generation != generation {
        if let Ok(mut process) = result {
            let _ = process.stop();
        }
        return runtime.connection_response();
    }

    apply_sidecar_launch_result(&mut runtime, generation, result);
    runtime.connection_response()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(setup_application)
        .invoke_handler(tauri::generate_handler![
            get_sidecar_connection,
            restart_sidecar
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(handle_run_event);
}

fn setup_application(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let project_root = project_root_from_manifest();
    let data_root = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_root)?;

    let allowed_origins = collect_allowed_origins(resolve_window_origin(app));
    let health_origin = select_health_check_origin(&allowed_origins).to_string();
    let (sidecar_executable, rg_executable) = resolve_packaged_runtime_paths(app)?;
    let runtime = SidecarRuntime {
        allowed_origins,
        data_root: data_root.clone(),
        health_origin,
        launch_generation: 0,
        process: None,
        project_root: project_root.clone(),
        rg_executable,
        sidecar_executable,
        startup_error: None,
        startup_in_progress: false,
    };

    app.manage(SidecarState(Mutex::new(runtime)));
    spawn_sidecar_launch(app.handle().clone());

    Ok(())
}

fn spawn_sidecar_launch(app: AppHandle) {
    let (generation, launch_config) = {
        let state = app.state::<SidecarState>();
        let Ok(mut runtime) = state.lock_inner() else {
            return;
        };
        runtime.launch_generation += 1;
        runtime.startup_in_progress = true;
        runtime.startup_error = None;
        (runtime.launch_generation, runtime.launch_config())
    };

    std::thread::spawn(move || {
        let state = app.state::<SidecarState>();
        let result = start_sidecar_blocking(&launch_config);
        if let Ok(mut runtime) = state.lock_inner() {
            apply_sidecar_launch_result(&mut runtime, generation, result);
        } else if let Ok(mut process) = result {
            let _ = process.stop();
        };
    });
}

fn handle_run_event(app_handle: &AppHandle, event: RunEvent) {
    if matches!(event, RunEvent::Exit) {
        if let Some(state) = app_handle.try_state::<SidecarState>() {
            if let Ok(mut runtime) = state.lock_inner() {
                runtime.launch_generation += 1;
                runtime.startup_in_progress = false;
                let _ = runtime.stop_sidecar();
            }
        }
    }
}

impl SidecarRuntime {
    fn launch_config(&self) -> SidecarLaunchConfig {
        SidecarLaunchConfig {
            allowed_origins: self.allowed_origins.clone(),
            data_root: self.data_root.clone(),
            health_origin: self.health_origin.clone(),
            project_root: self.project_root.clone(),
            rg_executable: self.rg_executable.clone(),
            sidecar_executable: self.sidecar_executable.clone(),
        }
    }

    fn connection_response(&mut self) -> Result<SidecarConnectionResponse, String> {
        if let Some(error) = self.startup_error.as_ref() {
            return Err(error.clone());
        }

        if self.startup_in_progress {
            return Err(SIDECAR_STARTING_MESSAGE.to_string());
        }

        let process = self
            .process
            .as_mut()
            .ok_or_else(|| "ローカルAPIサーバーが起動していません。".to_string())?;

        if !process
            .is_running()
            .map_err(|error| sanitize_sidecar_error(&error))?
        {
            return Err("ローカルAPIサーバーが停止しました。再起動してください。".to_string());
        }

        Ok(connection_to_response(process.connection()))
    }

    fn stop_sidecar(&mut self) -> Result<(), SidecarError> {
        if let Some(mut process) = self.process.take() {
            process.stop()?;
        }

        Ok(())
    }
}

fn start_sidecar_blocking(config: &SidecarLaunchConfig) -> Result<SidecarProcess, SidecarError> {
    let launch = SidecarLaunch::new(
        config.project_root.clone(),
        config.data_root.clone(),
        config.allowed_origins.clone(),
        config.sidecar_executable.clone(),
        config.rg_executable.clone(),
    );

    {
        let mut process = SidecarProcess::spawn(launch, READINESS_TIMEOUT)?;
        if !process.check_health(&config.health_origin, HEALTH_CHECK_TIMEOUT)? {
            process.stop()?;
            return Err(SidecarError::HealthCheckFailed);
        }

        Ok(process)
    }
}

fn apply_sidecar_launch_result(
    runtime: &mut SidecarRuntime,
    generation: u64,
    result: Result<SidecarProcess, SidecarError>,
) {
    if runtime.launch_generation != generation {
        if let Ok(mut process) = result {
            let _ = process.stop();
        }
        return;
    }

    runtime.startup_in_progress = false;
    match result {
        Ok(process) => {
            runtime.startup_error = None;
            runtime.process = Some(process);
        }
        Err(error) => {
            runtime.startup_error = Some(sanitize_sidecar_error(&error));
        }
    }
}

fn connection_to_response(connection: &SidecarConnection) -> SidecarConnectionResponse {
    SidecarConnectionResponse {
        token: connection.token.clone(),
        url: connection.url.to_string(),
    }
}

fn project_root_from_manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must live inside the project root")
        .to_path_buf()
}

fn default_production_origin() -> &'static str {
    if cfg!(target_os = "windows") {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}

fn collect_allowed_origins(window_origin: Option<String>) -> Vec<String> {
    let mut origins = vec![default_production_origin().to_string()];

    if let Some(origin) = window_origin {
        if !origins.iter().any(|existing| existing == &origin) {
            origins.push(origin);
        }
    }

    origins
}

fn resolve_window_origin(app: &tauri::App) -> Option<String> {
    let window = app.get_webview_window("main")?;
    let url = window.url().ok()?;
    Some(origin_from_url(&url))
}

fn origin_from_url(url: &Url) -> String {
    let scheme = url.scheme();
    let host = url.host_str().unwrap_or_default();

    match url.port() {
        Some(port) => format!("{scheme}://{host}:{port}"),
        None => format!("{scheme}://{host}"),
    }
}

fn resolve_packaged_runtime_paths(
    app: &tauri::App,
) -> Result<(Option<PathBuf>, Option<PathBuf>), Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return Ok((None, None));
    }

    #[cfg(not(debug_assertions))]
    {
        Ok((
            Some(resolve_bundled_sidecar_executable()?),
            Some(resolve_bundled_rg_executable(app)?),
        ))
    }
}

#[cfg(not(debug_assertions))]
fn resolve_bundled_sidecar_executable() -> Result<PathBuf, String> {
    let executable_directory = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "missing executable directory".to_string())?;
    let candidate = executable_directory.join(bundled_sidecar_filename());

    if candidate.is_file() {
        Ok(candidate)
    } else {
        Err(format!(
            "bundled sidecar executable not found: {}",
            candidate.display()
        ))
    }
}

pub fn bundled_rg_candidate_paths(resource_dir: &std::path::Path) -> Vec<PathBuf> {
    let candidate_roots = [
        resource_dir.to_path_buf(),
        resource_dir
            .join("runtime-artifacts")
            .join("ripgrep")
            .join("current"),
    ];

    let mut candidates = Vec::new();
    for candidate_root in candidate_roots {
        for candidate_name in ["rg", "rg.exe"] {
            candidates.push(candidate_root.join(candidate_name));
        }
    }

    candidates
}

#[cfg(not(debug_assertions))]
fn resolve_bundled_rg_executable(app: &tauri::App) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;

    for candidate in bundled_rg_candidate_paths(&resource_dir) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "bundled ripgrep executable not found in {}",
        resource_dir.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn runtime_without_process() -> SidecarRuntime {
        SidecarRuntime {
            allowed_origins: vec!["tauri://localhost".to_string()],
            data_root: PathBuf::from("/data"),
            health_origin: "tauri://localhost".to_string(),
            launch_generation: 0,
            process: None,
            project_root: PathBuf::from("/project"),
            rg_executable: None,
            sidecar_executable: None,
            startup_error: None,
            startup_in_progress: false,
        }
    }

    #[test]
    fn bundled_rg_candidate_paths_include_resource_root_and_current_directory() {
        let resource_dir = Path::new("/Applications/Ghostwriter.app/Contents/Resources");
        let candidates = bundled_rg_candidate_paths(resource_dir);

        assert!(candidates.contains(&resource_dir.join("rg")));
        assert!(candidates.contains(&resource_dir.join("rg.exe")));
        assert!(candidates.contains(
            &resource_dir
                .join("runtime-artifacts")
                .join("ripgrep")
                .join("current")
                .join("rg")
        ));
        assert!(candidates.contains(
            &resource_dir
                .join("runtime-artifacts")
                .join("ripgrep")
                .join("current")
                .join("rg.exe")
        ));
    }

    #[test]
    fn connection_response_reports_starting_while_background_launch_is_running() {
        let mut runtime = runtime_without_process();
        runtime.startup_in_progress = true;

        let error = runtime.connection_response().unwrap_err();

        assert_eq!(error, SIDECAR_STARTING_MESSAGE);
    }

    #[test]
    fn failed_background_launch_records_startup_error() {
        let mut runtime = runtime_without_process();
        runtime.launch_generation = 1;
        runtime.startup_in_progress = true;

        apply_sidecar_launch_result(&mut runtime, 1, Err(SidecarError::ReadinessTimeout));

        assert!(!runtime.startup_in_progress);
        assert_eq!(
            runtime.startup_error.as_deref(),
            Some("ローカルAPIサーバーの起動確認がタイムアウトしました。")
        );
        assert_eq!(
            runtime.connection_response().unwrap_err(),
            "ローカルAPIサーバーの起動確認がタイムアウトしました。"
        );
    }

}

fn sanitize_sidecar_error(error: &SidecarError) -> String {
    match error {
        SidecarError::ReadinessTimeout => {
            "ローカルAPIサーバーの起動確認がタイムアウトしました。".to_string()
        }
        SidecarError::NotRunning | SidecarError::Stopped => {
            "ローカルAPIサーバーが停止しました。再起動してください。".to_string()
        }
        _ => "ローカルAPIサーバーを起動できませんでした。".to_string(),
    }
}
