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
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
static CLOUDFLARED_CHILD: OnceLock<Arc<StdMutex<Option<CommandChild>>>> = OnceLock::new();
static CLOUDFLARED_URL: OnceLock<Arc<StdMutex<Option<String>>>> = OnceLock::new();

#[cfg(windows)]
mod win_job {
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

    /// Devuelve el Job Object global (si existe) para asignarle procesos hijos.
    pub fn get_job() -> Option<&'static JobGuard> {
        // El JobGuard se crea en run() y se mueve al closure de setup; para
        // compartirlo con los comandos usamos un lazy static.
        JOB_HANDLE.get()
    }

    use std::sync::OnceLock;
    static JOB_HANDLE: OnceLock<JobGuard> = OnceLock::new();

    /// Inicializa el Job Object global (llamar una vez en run()).
    pub fn init_job() -> Option<()> {
        let job = JobGuard::new()?;
        JOB_HANDLE.set(job).ok()?;
        Some(())
    }
}

#[tauri::command]
async fn repair(app: tauri::AppHandle) -> Result<String, String> {
    use std::fs;
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

    // §fix share-link: usar el NOMBRE REAL empaquetado por Tauri.
    // tauri.conf.json declara `cloudflared` en externalBin, y Tauri empaqueta el
    // binario con el target triple: cloudflared-x86_64-pc-windows-msvc.exe
    // (NO cloudflared.exe). Si repair() busca "cloudflared.exe", src.exists() es
    // falso y el sidecar nunca se redeploya al dir del .exe. Alinear nombres.
    let binaries: [(&str, &str); 2] = [
        ("relay-rust.exe", "relay-rust.exe"),
        ("cloudflared.exe", "cloudflared-x86_64-pc-windows-msvc.exe"),
    ];
    let mut repaired = Vec::new();
    let exe_dir = std::env::current_exe()
        .map(|p| p.parent().map(|x| x.to_path_buf()).unwrap_or_default())
        .unwrap_or_default();

    for (logical, packaged) in binaries.iter() {
        let src = resource_dir.join(packaged);
        if !src.exists() {
            continue;
        }
        let dst = exe_dir.join(logical);
        fs::copy(&src, &dst).map_err(|e| format!("No se pudo reparar {logical}: {e}"))?;
        repaired.push(logical.to_string());
    }

    if repaired.is_empty() {
        Ok("Nada que reparar (sidecars ya presentes).".into())
    } else {
        Ok(format!("Reparado: {}", repaired.join(", ")))
    }
}

#[tauri::command]
async fn share_link(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_shell::process::CommandEvent;
    use std::time::{Duration, Instant};

    // §6.1 FIX: get_or_init defensivo en vez de .unwrap() — evita panic si el
    // backend llama a share_link antes de que run()->setup() haya corrido get_or_init.
    let child_arc = CLOUDFLARED_CHILD.get_or_init(|| Arc::new(StdMutex::new(None))).clone();
    let url_arc = CLOUDFLARED_URL.get_or_init(|| Arc::new(StdMutex::new(None))).clone();

    // Si ya hay un túnel activo, devolver la URL cached.
    {
        let guard = url_arc.lock().unwrap();
        if let Some(url) = guard.clone() {
            return Ok(url);
        }
    }

    let command = app
        .shell()
        .sidecar("cloudflared")
        .map_err(|e| format!("No se encontró cloudflared: {e}"))?
        .args(["tunnel", "--url", "http://localhost:8080"]);

    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("No se pudo lanzar cloudflared: {e}"))?;

    // Asignar al Job Object para que muera con el padre.
    #[cfg(windows)]
    {
        if let Some(ref job) = win_job::get_job() {
            let _ = job.assign(child.pid());
        }
    }

    *child_arc.lock().unwrap() = Some(child);

    // Capturar la URL del stdout (ej. "https://xxxx.trycloudflare.com").
    let url_arc_spawn = Arc::clone(&url_arc);
    tauri::async_runtime::spawn(async move {
        let re = regex::Regex::new(r"https://[a-z0-9-]+\.trycloudflare\.com").unwrap();
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(b) | CommandEvent::Stderr(b) = event {
                let s = String::from_utf8_lossy(&b);
                if let Some(m) = re.find(&s) {
                    *url_arc_spawn.lock().unwrap() = Some(m.as_str().to_string());
                }
            }
        }
    });

    // Esperar hasta 15s a que aparezca la URL (cloudflared 2026.x puede tardar
    // hasta ~11s en emitir el quick tunnel URL). §fix timing
    let start = Instant::now();
    loop {
        if let Some(url) = url_arc.lock().unwrap().clone() {
            return Ok(url);
        }
        if start.elapsed() > Duration::from_secs(15) {
            return Err("Timeout esperando la URL del túnel.".into());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(serde_json::json!({
            "available": true,
            "currentVersion": update.current_version,
            "latestVersion": update.version,
            "notes": update.body,
        })),
        Ok(None) => Ok(serde_json::json!({ "available": false })),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update
            .download_and_install(|_len, _total| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn stop_link(_app: tauri::AppHandle) -> Result<(), String> {
    if let Some(child_arc) = CLOUDFLARED_CHILD.get() {
        if let Some(child) = child_arc.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
    if let Some(url_arc) = CLOUDFLARED_URL.get() {
        *url_arc.lock().unwrap() = None;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Job object global para matar los sidecars si este proceso muere por cualquier causa.
    #[cfg(windows)]
    win_job::init_job();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            CLOUDFLARED_CHILD.get_or_init(|| Arc::new(StdMutex::new(None)));
            CLOUDFLARED_URL.get_or_init(|| Arc::new(StdMutex::new(None)));
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
                            if let Some(ref job) = win_job::get_job() {
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
        .invoke_handler(tauri::generate_handler![repair, share_link, stop_link, check_update, install_update])
        .run(tauri::generate_context!())
        .expect("error al correr la app Tauri");
}

fn main() {
    run();
}
