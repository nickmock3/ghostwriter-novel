use std::path::PathBuf;
use std::time::Duration;

use ghostwriter_lib::sidecar::{SidecarLaunch, SidecarProcess};

#[test]
fn starts_authenticated_sidecar_and_stops_the_child_process() {
    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must be inside the project root")
        .to_path_buf();
    let data_root = tempfile::tempdir().expect("temporary app data directory");
    let origin = "tauri://localhost";
    let launch = SidecarLaunch::development(
        project_root,
        data_root.path().to_path_buf(),
        vec![origin.to_string()],
    );

    let mut process =
        SidecarProcess::spawn(launch, Duration::from_secs(60)).expect("sidecar should start");
    let connection = process.connection().clone();

    assert_eq!(connection.url.scheme(), "http");
    assert_eq!(connection.url.host_str(), Some("127.0.0.1"));
    assert!(process
        .check_health(origin, Duration::from_secs(2))
        .expect("authenticated health check should complete"));
    assert!(process.is_running().expect("sidecar process status"));

    process.stop().expect("sidecar should stop");

    assert!(!process
        .is_running()
        .expect("stopped sidecar process status"));
}
