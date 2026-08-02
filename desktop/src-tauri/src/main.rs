// WindChat Desktop — Launcher Tauri (Rust).
//
// Arranca el relay E2EE (relay-rust.exe sidecar) al iniciar y garantiza que se
// mata en CUALQUIER salida del proceso padre (cierre de ventana, crash, kill
// forzado) usando un Windows Job Object. Así no quedan procesos huérfanos.
// El frontend (client/dist) se conecta al relay vía ws://127.0.0.1:8080.

use std::sync::Mutex;
use tauri::{Manager, WindowEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

struct RelayChild(Mutex<Option<CommandChild>>);

#[cfg(windows)]
mod win_job {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::OpenProcess;
    use windows_sys::Win32::System::Threading::PROCESS_ALL_ACCESS;

    /// Crea un Job Object que mata sus procesos hijos cuando se cierra el handle
    /// (es decir: cuando muere el proceso padre que lo posee). Devuelve el handle
    /// para mantenerlo vivo mientras dure la app.
    pub struct JobGuard(pub HANDLE);

    impl JobGuard {
        pub fn new() -> Option<Self> {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job == 0 {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = windows_sys::Win32::System::JobObjects::SetInformationJobObject(
                    job,
                    windows_sys::Win32::System::JobObjects::JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of_val(&info) as u32,
                );
                if ok == 0 {
                    CloseHandle(job);
                    return None;
                }
                Some(JobGuard(job))
            }
        }

        pub fn assign(&self, pid: u32) -> bool {
            unsafe {
                let h = OpenProcess(PROCESS_ALL_ACCESS, 0, pid);
                if h == 0 {
                    return false;
                }
                let ok = AssignProcessToJobObject(self.0, h);
                CloseHandle(h);
                ok != 0
            }
        }
    }

    impl Drop for JobGuard {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[tauri::command]
async fn repair(app: tauri::AppHandle) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("No resource_dir: {e}"))?;

    // Directorio donde Tauri espera los sidecars (junto al ejecutable).
    let sidecar_dir = app
        .path()
        .resolve("relay-rust", tauri::path::BaseDirectory::Resource)
        .unwrap_or_else(|_| resource_dir.clone());
    let _ = sidecar_dir;

    let binaries = ["relay-rust.exe", "cloudflared.exe"];
    let mut repaired = Vec::new();
    let exe_dir = std::env::current_exe()
        .map(|p| p.parent().map(|x| x.to_path_buf()).unwrap_or_default())
        .unwrap_or_default();

    for bin in binaries.iter() {
        let src = resource_dir.join(bin);
        if !src.exists() {
            continue;
        }
        let dst = exe_dir.join(bin);
        fs::copy(&src, &dst).map_err(|e| format!("No se pudo reparar {bin}: {e}"))?;
        repaired.push(bin.to_string());
    }

    if repaired.is_empty() {
        Ok("Nada que reparar (sidecars ya presentes).".into())
    } else {
        Ok(format!("Reparado: {}", repaired.join(", ")))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Job object para matar el relay si este proceso muere por cualquier causa.
    #[cfg(windows)]
    let job = win_job::JobGuard::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            match app.shell().sidecar("relay-rust") {
                Ok(mut command) => {
                    command = command.args(["--port", "8080"]);
                    match command.spawn() {
                        Ok((mut rx, child)) => {
                            // Mantener viva la tubería de eventos del sidecar:
                            // si se suelta `rx`, el pipe se cierra y el relay
                            // (que escribe en stdout) muere.
                            tauri::async_runtime::spawn(async move {
                                while let Some(event) = rx.recv().await {
                                    match event {
                                        tauri_plugin_shell::process::CommandEvent::Stdout(b)
                                        | tauri_plugin_shell::process::CommandEvent::Stderr(b) => {
                                            let s = String::from_utf8_lossy(&b);
                                            for line in s.lines() {
                                                println!("[relay] {line}");
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            });
                            // Asignar el relay al Job Object (muere con el padre).
                            #[cfg(windows)]
                            if let Some(ref job) = job {
                                let _ = job.assign(child.pid());
                            }
                            app.manage(RelayChild(Mutex::new(Some(child))));
                            println!("🚀 Relay sidecar arrancado en puerto 8080");
                        }
                        Err(e) => {
                            eprintln!("❌ No se pudo lanzar el relay sidecar: {e}");
                        }
                    }
                }
                Err(e) => {
                    eprintln!("❌ No se encontró el sidecar relay-rust: {e}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<RelayChild>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                            println!("🛑 Relay sidecar detenido");
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![repair])
        .run(tauri::generate_context!())
        .expect("error al correr la app Tauri");
}

fn main() {
    run();
}
