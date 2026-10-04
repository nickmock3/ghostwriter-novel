use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let profile = std::env::var("PROFILE").unwrap_or_default();
    let target_triple = std::env::var("TARGET").unwrap_or_default();
    let sidecar_artifact = sidecar_build_artifact_path(&manifest_dir, &target_triple);
    let ripgrep_resource_dir = manifest_dir.join("runtime-artifacts/ripgrep/current");

    if !sidecar_artifact.exists() {
        if profile == "release" {
            panic!(
                "missing validated sidecar artifact for release build: {}",
                sidecar_artifact.display()
            );
        }
        write_debug_sidecar_stub(&sidecar_artifact, &target_triple);
    }

    if !ripgrep_resource_dir
        .join(ripgrep_executable_name(&target_triple))
        .exists()
    {
        if profile == "release" {
            panic!(
                "missing validated ripgrep resource for release build: {}",
                ripgrep_resource_dir.display()
            );
        }
        write_debug_ripgrep_stub(&ripgrep_resource_dir, &target_triple);
    }

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["get_sidecar_connection", "restart_sidecar"]),
    ))
    .expect("failed to run tauri-build");
}

fn sidecar_build_artifact_path(manifest_dir: &Path, target_triple: &str) -> PathBuf {
    manifest_dir.join(format!(
        "runtime-artifacts/sidecar/{}",
        sidecar_build_artifact_name(target_triple)
    ))
}

fn sidecar_build_artifact_name(target_triple: &str) -> &'static str {
    match target_triple {
        "aarch64-apple-darwin" => "ghostwriter-sidecar-aarch64-apple-darwin",
        "x86_64-pc-windows-msvc" => "ghostwriter-sidecar-x86_64-pc-windows-msvc.exe",
        _ => "ghostwriter-sidecar",
    }
}

fn ripgrep_executable_name(target_triple: &str) -> &'static str {
    if target_triple.contains("windows") {
        "rg.exe"
    } else {
        "rg"
    }
}

fn write_debug_sidecar_stub(path: &Path, target_triple: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create sidecar artifact directory");
    }

    let bytes = executable_stub_bytes(target_triple);
    let mut file = fs::File::create(path).expect("create debug sidecar stub");
    file.write_all(&bytes).expect("write debug sidecar stub");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = file
            .metadata()
            .expect("sidecar stub metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("chmod debug sidecar stub");
    }
}

fn write_debug_ripgrep_stub(resource_dir: &Path, target_triple: &str) {
    fs::create_dir_all(resource_dir).expect("create ripgrep resource directory");
    let path = resource_dir.join(ripgrep_executable_name(target_triple));
    let bytes = executable_stub_bytes(target_triple);
    let mut file = fs::File::create(&path).expect("create debug ripgrep stub");
    file.write_all(&bytes).expect("write debug ripgrep stub");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = file
            .metadata()
            .expect("ripgrep stub metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("chmod debug ripgrep stub");
    }
}

fn executable_stub_bytes(target_triple: &str) -> Vec<u8> {
    if target_triple.contains("windows") {
        create_pe_stub(0x8664)
    } else if target_triple == "aarch64-apple-darwin" {
        create_macho_stub(0x0100_000c)
    } else {
        create_macho_stub(0x0100_0007)
    }
}

fn create_macho_stub(cpu_type: u32) -> Vec<u8> {
    let mut bytes = vec![0_u8; 64];
    bytes[0..4].copy_from_slice(&0xfeed_facf_u32.to_le_bytes());
    bytes[4..8].copy_from_slice(&cpu_type.to_le_bytes());
    bytes
}

fn create_pe_stub(machine: u16) -> Vec<u8> {
    let mut bytes = vec![0_u8; 128];
    bytes[0] = 0x4d;
    bytes[1] = 0x5a;
    bytes[0x3c..0x40].copy_from_slice(&0x40_u32.to_le_bytes());
    bytes[0x40] = 0x50;
    bytes[0x41] = 0x45;
    bytes[0x44..0x46].copy_from_slice(&machine.to_le_bytes());
    bytes
}
