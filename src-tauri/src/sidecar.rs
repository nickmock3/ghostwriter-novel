use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt::{self, Display};
use std::io::{self, BufRead, BufReader};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use url::Url;

const SIDECAR_SCRIPT: &str = "src/shared/server/standaloneServer.ts";
const SIDECAR_EXECUTABLE_ENV: &str = "GHOSTWRITER_SIDECAR_EXECUTABLE";
const RG_EXECUTABLE_ENV: &str = "GHOSTWRITER_RG_EXECUTABLE";
const TOKEN_ENV: &str = "GHOSTWRITER_SIDECAR_TOKEN";
const ALLOWED_ORIGINS_ENV: &str = "GHOSTWRITER_ALLOWED_ORIGINS";
const DATA_DIR_ENV: &str = "GHOSTWRITER_DATA_DIR";
const PARENT_PID_ENV: &str = "GHOSTWRITER_PARENT_PID";
const RUNTIME_MODE_ENV: &str = "GHOSTWRITER_RUNTIME_MODE";
const PACKAGED_DESKTOP_RUNTIME_MODE: &str = "desktop-packaged";
const HEALTH_PATH: &str = "/health";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, PartialEq, Eq)]
pub struct SidecarConnection {
    pub token: String,
    pub url: Url,
}

#[derive(Clone, Debug)]
enum ExecutableSpec {
    DevelopmentBun,
    Override(PathBuf),
}

#[derive(Clone)]
pub struct SidecarLaunch {
    allowed_origins: Vec<String>,
    data_root: PathBuf,
    executable: ExecutableSpec,
    project_root: PathBuf,
    rg_executable: Option<PathBuf>,
    token: String,
}

#[derive(Debug)]
pub enum SidecarError {
    HealthCheckFailed,
    InvalidReadiness {
        details: String,
    },
    Io(io::Error),
    NotRunning,
    ReadinessTimeout,
    Spawn {
        details: String,
    },
    Stopped,
}

impl Display for SidecarError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HealthCheckFailed => write!(formatter, "sidecar health check failed"),
            Self::InvalidReadiness { details } => {
                write!(formatter, "invalid sidecar readiness payload: {details}")
            }
            Self::Io(error) => write!(formatter, "{error}"),
            Self::NotRunning => write!(formatter, "sidecar process is not running"),
            Self::ReadinessTimeout => write!(formatter, "timed out waiting for sidecar readiness"),
            Self::Spawn { details } => write!(formatter, "failed to start sidecar: {details}"),
            Self::Stopped => write!(formatter, "sidecar process is stopped"),
        }
    }
}

impl std::error::Error for SidecarError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for SidecarError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub struct SidecarProcess {
    child: Option<RefCell<Child>>,
    connection: SidecarConnection,
}

#[derive(Deserialize)]
struct ReadinessPayload {
    url: String,
}

impl SidecarLaunch {
    pub fn new(
        project_root: PathBuf,
        data_root: PathBuf,
        allowed_origins: Vec<String>,
        sidecar_executable: Option<PathBuf>,
        rg_executable: Option<PathBuf>,
    ) -> Self {
        Self {
            allowed_origins,
            data_root,
            executable: resolve_executable_spec(sidecar_executable),
            project_root,
            rg_executable,
            token: generate_token(),
        }
    }

    pub fn development(
        project_root: PathBuf,
        data_root: PathBuf,
        allowed_origins: Vec<String>,
    ) -> Self {
        Self::new(project_root, data_root, allowed_origins, None, None)
    }

    pub fn allowed_origins(&self) -> &[String] {
        &self.allowed_origins
    }

    pub fn data_root(&self) -> &Path {
        &self.data_root
    }

    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    pub fn rg_executable(&self) -> Option<&Path> {
        self.rg_executable.as_deref()
    }

    pub fn with_fresh_token(mut self) -> Self {
        self.token = generate_token();
        self
    }

}

impl SidecarProcess {
    pub fn spawn(launch: SidecarLaunch, readiness_timeout: Duration) -> Result<Self, SidecarError> {
        let mut child = spawn_child(&launch)?;
        let stdout = child.stdout.take().ok_or_else(|| SidecarError::Spawn {
            details: "sidecar stdout was not captured".to_string(),
        })?;

        let readiness_line = match read_readiness_line(stdout, readiness_timeout) {
            Ok(line) => line,
            Err(error) => {
                cleanup_child(&mut child);
                return Err(error);
            }
        };

        let url = match parse_readiness_url(&readiness_line) {
            Ok(url) => url,
            Err(error) => {
                cleanup_child(&mut child);
                return Err(error);
            }
        };

        Ok(Self {
            child: Some(RefCell::new(child)),
            connection: SidecarConnection {
                token: launch.token,
                url,
            },
        })
    }

    pub fn connection(&self) -> &SidecarConnection {
        &self.connection
    }

    pub fn check_health(&self, origin: &str, timeout: Duration) -> Result<bool, SidecarError> {
        if !self.is_running()? {
            return Err(SidecarError::NotRunning);
        }

        let health_url = self.connection.url.join(HEALTH_PATH).map_err(|error| {
            SidecarError::InvalidReadiness {
                details: error.to_string(),
            }
        })?;
        let deadline = Instant::now() + timeout;

        while Instant::now() < deadline {
            if !self.is_running()? {
                return Err(SidecarError::NotRunning);
            }

            match perform_health_request(&health_url, origin, &self.connection.token) {
                Ok(true) => return Ok(true),
                Ok(false) => thread::sleep(Duration::from_millis(100)),
                Err(SidecarError::NotRunning) => return Err(SidecarError::NotRunning),
                Err(_) => thread::sleep(Duration::from_millis(100)),
            }
        }

        Ok(false)
    }

    pub fn is_running(&self) -> Result<bool, SidecarError> {
        let Some(child) = &self.child else {
            return Ok(false);
        };

        match child.borrow_mut().try_wait()? {
            Some(_) => Ok(false),
            None => Ok(true),
        }
    }

    pub fn stop(&mut self) -> Result<(), SidecarError> {
        if let Some(child) = self.child.take() {
            let mut child = child.into_inner();
            let _ = child.kill();
            let _ = child.wait();
        }

        Ok(())
    }
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

pub fn generate_token() -> String {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).expect("cryptographic random bytes");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn validate_loopback_url(raw_url: &str) -> Result<Url, SidecarError> {
    let url = Url::parse(raw_url).map_err(|error| SidecarError::InvalidReadiness {
        details: error.to_string(),
    })?;

    if url.scheme() != "http" {
        return Err(SidecarError::InvalidReadiness {
            details: "sidecar URL must use http".to_string(),
        });
    }

    if url.host_str() != Some("127.0.0.1") {
        return Err(SidecarError::InvalidReadiness {
            details: "sidecar URL must target 127.0.0.1".to_string(),
        });
    }

    if url.port().is_none() {
        return Err(SidecarError::InvalidReadiness {
            details: "sidecar URL must include an explicit port".to_string(),
        });
    }

    Ok(url)
}

pub fn format_allowed_origins(origins: &[String]) -> String {
    origins.join(",")
}

pub fn select_health_check_origin(allowed_origins: &[String]) -> &str {
    #[cfg(debug_assertions)]
    {
        if let Some(origin) = allowed_origins
            .iter()
            .find(|origin| origin.starts_with("http://") || origin.starts_with("https://"))
        {
            return origin;
        }
    }

    allowed_origins
        .first()
        .map(String::as_str)
        .unwrap_or("tauri://localhost")
}

fn sidecar_working_directory(launch: &SidecarLaunch) -> &Path {
    match &launch.executable {
        ExecutableSpec::DevelopmentBun => &launch.project_root,
        ExecutableSpec::Override(_) => &launch.data_root,
    }
}

pub fn sidecar_spawn_environment(launch: &SidecarLaunch) -> HashMap<String, String> {
    let mut environment = HashMap::from([
        (TOKEN_ENV.to_string(), launch.token.clone()),
        (
            ALLOWED_ORIGINS_ENV.to_string(),
            format_allowed_origins(&launch.allowed_origins),
        ),
        (
            DATA_DIR_ENV.to_string(),
            launch.data_root.to_string_lossy().into_owned(),
        ),
        (PARENT_PID_ENV.to_string(), std::process::id().to_string()),
    ]);

    if let Some(rg_executable) = launch.rg_executable() {
        environment.insert(
            RG_EXECUTABLE_ENV.to_string(),
            rg_executable.to_string_lossy().into_owned(),
        );
    }

    if matches!(launch.executable, ExecutableSpec::Override(_)) {
        environment.insert(
            RUNTIME_MODE_ENV.to_string(),
            PACKAGED_DESKTOP_RUNTIME_MODE.to_string(),
        );
    }

    environment
}

pub fn packaged_sidecar_filename() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "ghostwriter-sidecar.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "ghostwriter-sidecar"
    }
}

pub fn bundled_sidecar_filename() -> &'static str {
    packaged_sidecar_filename()
}

fn resolve_executable_spec(sidecar_executable: Option<PathBuf>) -> ExecutableSpec {
    if let Some(path) = sidecar_executable {
        return ExecutableSpec::Override(path);
    }

    if let Ok(path) = std::env::var(SIDECAR_EXECUTABLE_ENV) {
        if !path.trim().is_empty() {
            return ExecutableSpec::Override(PathBuf::from(path));
        }
    }

    ExecutableSpec::DevelopmentBun
}

fn spawn_child(launch: &SidecarLaunch) -> Result<Child, SidecarError> {
    let working_directory = sidecar_working_directory(launch);
    let mut command = match &launch.executable {
        ExecutableSpec::DevelopmentBun => {
            let mut command = Command::new("bun");
            command.args(["run", SIDECAR_SCRIPT]);
            command
        }
        ExecutableSpec::Override(path) => Command::new(path),
    };
    command.current_dir(working_directory);

    for (key, value) in sidecar_spawn_environment(launch) {
        command.env(key, value);
    }

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    command.spawn().map_err(|error| SidecarError::Spawn {
        details: error.to_string(),
    })
}

fn read_readiness_line(stdout: ChildStdout, timeout: Duration) -> Result<String, SidecarError> {
    let (sender, receiver) = mpsc::sync_channel::<Result<String, SidecarError>>(1);

    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let result = match reader.read_line(&mut line) {
            Ok(0) => Err(SidecarError::InvalidReadiness {
                details: "sidecar closed stdout before readiness".to_string(),
            }),
            Ok(_) => Ok(line),
            Err(error) => Err(SidecarError::Io(error)),
        };
        let _ = sender.send(result);

        for line in reader.lines() {
            if line.is_err() {
                break;
            }
        }
    });

    receiver
        .recv_timeout(timeout)
        .map_err(|_| SidecarError::ReadinessTimeout)?
}

fn parse_readiness_url(line: &str) -> Result<Url, SidecarError> {
    let payload: ReadinessPayload =
        serde_json::from_str(line.trim()).map_err(|error| SidecarError::InvalidReadiness {
            details: error.to_string(),
        })?;

    validate_loopback_url(&payload.url)
}

fn perform_health_request(
    health_url: &Url,
    origin: &str,
    token: &str,
) -> Result<bool, SidecarError> {
    let response = ureq::get(health_url.as_str())
        .set("Authorization", &format!("Bearer {token}"))
        .set("Origin", origin)
        .call();

    match response {
        Ok(response) => Ok(response.status() == 200),
        Err(ureq::Error::Status(401 | 403, _)) => Ok(false),
        Err(ureq::Error::Status(_, _)) => Ok(false),
        Err(ureq::Error::Transport(error)) => {
            Err(SidecarError::Io(io::Error::other(error.to_string())))
        }
    }
}

fn cleanup_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_token_produces_hex_secret() {
        let token = generate_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn validate_loopback_url_accepts_localhost_port() {
        let url = validate_loopback_url("http://127.0.0.1:4317").expect("valid loopback url");
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        assert_eq!(url.port(), Some(4317));
    }

    #[test]
    fn validate_loopback_url_rejects_non_loopback_hosts() {
        let error = validate_loopback_url("http://localhost:4317").expect_err("invalid host");
        assert!(matches!(error, SidecarError::InvalidReadiness { .. }));
    }

    #[test]
    fn parse_readiness_url_rejects_invalid_payload() {
        let error = parse_readiness_url("not-json").expect_err("invalid readiness");
        assert!(matches!(error, SidecarError::InvalidReadiness { .. }));
    }

    #[test]
    fn format_allowed_origins_uses_exact_commas() {
        assert_eq!(
            format_allowed_origins(&[
                "tauri://localhost".to_string(),
                "http://tauri.localhost".to_string(),
            ]),
            "tauri://localhost,http://tauri.localhost"
        );
    }

    #[test]
    fn packaged_sidecar_filename_uses_unsuffixed_runtime_name() {
        #[cfg(target_os = "windows")]
        assert_eq!(packaged_sidecar_filename(), "ghostwriter-sidecar.exe");

        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        assert_eq!(packaged_sidecar_filename(), "ghostwriter-sidecar");

        #[cfg(not(any(
            target_os = "windows",
            all(target_os = "macos", target_arch = "aarch64")
        )))]
        assert_eq!(packaged_sidecar_filename(), "ghostwriter-sidecar");
    }

    #[test]
    fn sidecar_spawn_environment_injects_rg_executable_when_configured() {
        let launch = SidecarLaunch::new(
            PathBuf::from("/project"),
            PathBuf::from("/data"),
            vec!["tauri://localhost".to_string()],
            Some(PathBuf::from(
                "/Applications/Ghostwriter.app/Contents/MacOS/ghostwriter-sidecar",
            )),
            Some(PathBuf::from(
                "/Applications/Ghostwriter.app/Contents/Resources/rg",
            )),
        );

        let environment = sidecar_spawn_environment(&launch);

        assert_eq!(
            environment.get(RG_EXECUTABLE_ENV),
            Some(&"/Applications/Ghostwriter.app/Contents/Resources/rg".to_string())
        );
        assert_eq!(environment.get(TOKEN_ENV), Some(&launch.token));
        assert_eq!(environment.get(DATA_DIR_ENV), Some(&"/data".to_string()));
        assert_eq!(
            environment.get("GHOSTWRITER_RUNTIME_MODE"),
            Some(&"desktop-packaged".to_string())
        );
    }

    #[test]
    fn development_sidecar_does_not_mark_runtime_as_packaged() {
        let launch = SidecarLaunch::development(
            PathBuf::from("/project"),
            PathBuf::from("/data"),
            vec!["http://localhost:1420".to_string()],
        );

        let environment = sidecar_spawn_environment(&launch);

        assert_eq!(environment.get("GHOSTWRITER_RUNTIME_MODE"), None);
        assert_eq!(environment.get(TOKEN_ENV), Some(&launch.token));
        assert_eq!(environment.get(DATA_DIR_ENV), Some(&"/data".to_string()));
    }

    #[test]
    fn development_sidecar_uses_project_root_as_working_directory() {
        let launch = SidecarLaunch::development(
            PathBuf::from("/project"),
            PathBuf::from("/data"),
            vec!["http://localhost:1420".to_string()],
        );

        assert_eq!(sidecar_working_directory(&launch), Path::new("/project"));
    }

    #[test]
    fn packaged_sidecar_uses_data_root_as_working_directory() {
        let launch = SidecarLaunch::new(
            PathBuf::from("/build-machine/project"),
            PathBuf::from("/application-data"),
            vec!["tauri://localhost".to_string()],
            Some(PathBuf::from(
                "/Applications/Ghostwriter.app/Contents/MacOS/ghostwriter-sidecar",
            )),
            None,
        );

        assert_eq!(
            sidecar_working_directory(&launch),
            Path::new("/application-data")
        );
        assert_ne!(
            sidecar_working_directory(&launch),
            Path::new("/build-machine/project")
        );
    }

    #[test]
    fn packaged_working_directory_does_not_require_project_root_to_exist() {
        let data_root = tempfile::tempdir().expect("temporary application data directory");
        let launch = SidecarLaunch::new(
            PathBuf::from("/missing/build-machine/project"),
            data_root.path().to_path_buf(),
            vec!["tauri://localhost".to_string()],
            Some(PathBuf::from("/packaged/ghostwriter-sidecar")),
            None,
        );

        assert_eq!(sidecar_working_directory(&launch), data_root.path());
        assert!(!launch.project_root().exists());
    }
}
