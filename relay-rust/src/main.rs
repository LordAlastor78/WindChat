//! WindChat E2EE Relay — Rust sidecar.
//!
//! Reenvía blobs cifrados entre hasta 2 clientes por room. NO descifra nada,
//! NO almacena mensajes, NO ve claves. Protocolo idéntico a `shared/protocol.ts`
//! y `server/src/index.ts` (el relay "tonto" de Node).
//!
//! Fix de reconexión (crítico): `seen_connection_ids` por room evita re-enviar
//! `peer_joined` en reconexiones del mismo dispositivo, lo que reiniciaría el
//! ratchet y desincronizaría a los peers (bug que fallaba en móvil).

use std::collections::{HashMap, HashSet};
use std::env;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use tokio_tungstenite::{
    accept_async,
    tungstenite::Message,
};

// ===== Constantes del protocolo (de shared/protocol.ts) =====
const MAX_MESSAGE_SIZE: usize = 10 * 1024 * 1024; // 10 MB
const MAX_USERS_PER_ROOM: usize = 2;
const P256_RAW_PUBLIC_KEY_SIZE: usize = 65;
const RATE_LIMIT_WINDOW_MS: u64 = 1000;
const MAX_MESSAGES_PER_WINDOW: usize = 10;
const MAX_JOINS_PER_WINDOW: usize = 3;
const SERVER_PING_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);
const HEARTBEAT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// ID monotónico de conexión (sustituye al `WebSocket` como clave de Map).
static CONN_ID: AtomicU64 = AtomicU64::new(0);

/// Metadatos de un cliente (compartidos entre el task de lectura y los handlers).
struct ClientMeta {
    room_id: Mutex<Option<String>>,
    public_key: Mutex<Option<String>>,
    display_name: Mutex<Option<String>>,
    connection_id: Mutex<Option<String>>,
    last_seen: Mutex<Instant>,
    is_alive: Mutex<bool>,
}

/// Entrada de cliente en una room: metadatos + canal de salida.
struct ClientEntry {
    meta: Arc<ClientMeta>,
    tx: mpsc::UnboundedSender<String>,
}

/// Una room efímera.
struct Room {
    clients: HashMap<usize, ClientEntry>,
    seen_connection_ids: HashSet<String>,
}

#[derive(Default)]
struct RateState {
    message_ts: Vec<u64>,
    join_ts: Vec<u64>,
}

type Rooms = Arc<Mutex<HashMap<String, Room>>>;
type RateBuckets = Arc<Mutex<HashMap<usize, RateState>>>;

struct AppState {
    rooms: Rooms,
    rate: RateBuckets,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn is_valid_base64(s: &str) -> bool {
    if s.is_empty() || s.len() % 4 != 0 {
        return false;
    }
    s.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
}

/// Clave P-256 sin comprimir: 65 bytes, byte 0 == 0x04.
fn is_valid_p256_pubkey(b64: &str) -> bool {
    if !is_valid_base64(b64) {
        return false;
    }
    match base64::engine::general_purpose::STANDARD.decode(b64) {
        Ok(raw) => raw.len() == P256_RAW_PUBLIC_KEY_SIZE && raw[0] == 0x04,
        Err(_) => false,
    }
}

async fn check_rate_limit(buckets: &RateBuckets, conn: usize, kind: &str) -> bool {
    let mut guard = buckets.lock().await;
    let state = guard.entry(conn).or_default();
    let now = now_ms();
    let window_start = now.saturating_sub(RATE_LIMIT_WINDOW_MS);
    let (ts, max) = if kind == "join" {
        (&mut state.join_ts, MAX_JOINS_PER_WINDOW)
    } else {
        (&mut state.message_ts, MAX_MESSAGES_PER_WINDOW)
    };
    ts.retain(|t| *t > window_start);
    if ts.len() >= max {
        return false;
    }
    ts.push(now);
    true
}

async fn cleanup_rate(buckets: &RateBuckets, conn: usize) {
    buckets.lock().await.remove(&conn);
}

/// Encola un mensaje JSON hacia un cliente concreto.
fn send_to(tx: &mpsc::UnboundedSender<String>, value: &Value) {
    if let Ok(s) = serde_json::to_string(value) {
        let _ = tx.send(s);
    }
}

async fn handle_connection(stream: TcpStream, state: Arc<AppState>) {
    let conn_id = CONN_ID.fetch_add(1, Ordering::Relaxed) as usize;
    let addr = stream.peer_addr().map(|a| a.to_string()).unwrap_or_default();
    eprintln!("✅ Nuevo cliente conectado (#{conn_id} from {addr})");

    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("⚠️ Fallo al aceptar WS: {e}");
            return;
        }
    };

    let (mut writer, mut reader) = ws_stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let meta = Arc::new(ClientMeta {
        room_id: Mutex::new(None),
        public_key: Mutex::new(None),
        display_name: Mutex::new(None),
        connection_id: Mutex::new(None),
        last_seen: Mutex::new(Instant::now()),
        is_alive: Mutex::new(true),
    });

    let mut last_ping = Instant::now();
    let mut closed = false;

    while !closed {
        tokio::select! {
            // Mensajes entrantes del socket
            msg = reader.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        *meta.last_seen.lock().await = Instant::now();
                        let raw = text.to_string();
                        if raw.len() > MAX_MESSAGE_SIZE {
                            eprintln!("⚠️ Mensaje demasiado grande: {} bytes", raw.len());
                            let _ = writer.send(Message::Close(None)).await;
                            break;
                        }
                        let value: Value = match serde_json::from_str(&raw) {
                            Ok(v) => v,
                            Err(_) => {
                                eprintln!("⚠️ Mensaje JSON inválido");
                                let _ = writer.send(Message::Close(None)).await;
                                break;
                            }
                        };
                        if !value.is_object() || value.get("type").and_then(|t| t.as_str()).is_none() {
                            eprintln!("⚠️ Mensaje sin tipo válido");
                            continue;
                        }
                        if let Err(e) = process_message(&state, conn_id, &meta, &tx, &value).await {
                            eprintln!("⚠️ Error procesando: {e}");
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = writer.send(Message::Pong(payload)).await;
                        *meta.last_seen.lock().await = Instant::now();
                    }
                    Some(Ok(Message::Pong(_))) => {
                        *meta.is_alive.lock().await = true;
                        *meta.last_seen.lock().await = Instant::now();
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        closed = true;
                        break;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        eprintln!("❌ WS error: {e}");
                        closed = true;
                        break;
                    }
                }
            }
            // Mensajes salientes encolados por otros handlers
            out = rx.recv() => {
                match out {
                    Some(s) => {
                        if writer.send(Message::Text(s.into())).await.is_err() {
                            closed = true;
                            break;
                        }
                    }
                    None => { closed = true; break; }
                }
            }
            // Heartbeat
            _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {
                if last_ping.elapsed() >= SERVER_PING_INTERVAL {
                    last_ping = Instant::now();
                    let alive = *meta.is_alive.lock().await;
                    if !alive {
                        eprintln!("⚠️ Cerrando cliente muerto (no pong)");
                        closed = true;
                        break;
                    }
                    *meta.is_alive.lock().await = false;
                    if writer.send(Message::Ping(vec![])).await.is_err() {
                        closed = true;
                        break;
                    }
                    if meta.last_seen.lock().await.elapsed() > HEARTBEAT_TIMEOUT {
                        eprintln!("⚠️ Timeout de inactividad");
                        closed = true;
                        break;
                    }
                }
            }
        }
    }

    cleanup_rate(&state.rate, conn_id).await;
    handle_disconnect(&state, conn_id).await;
    eprintln!("👋 Cliente #{conn_id} desconectado");
}

async fn process_message(
    state: &Arc<AppState>,
    conn_id: usize,
    meta: &Arc<ClientMeta>,
    tx: &mpsc::UnboundedSender<String>,
    value: &Value,
) -> anyhow::Result<()> {
    let msg_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match msg_type {
        "join" => handle_join(state, conn_id, meta, tx, value).await,
        "message" => handle_message(state, conn_id, meta, value).await,
        "typing" => handle_typing(state, conn_id, meta, value).await,
        "ping" => {
            let pong = serde_json::json!({"type": "pong"});
            send_to(tx, &pong);
            Ok(())
        }
        "pong" => {
            *meta.is_alive.lock().await = true;
            *meta.last_seen.lock().await = Instant::now();
            Ok(())
        }
        "disconnect" => Ok(handle_disconnect(state, conn_id).await),
        _ => {
            eprintln!("⚠️ Tipo de mensaje desconocido: {msg_type}");
            Ok(())
        }
    }
}

async fn handle_join(
    state: &Arc<AppState>,
    conn_id: usize,
    meta: &Arc<ClientMeta>,
    tx: &mpsc::UnboundedSender<String>,
    value: &Value,
) -> anyhow::Result<()> {
    let room_id = value
        .get("roomId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let public_key = value
        .get("publicKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let connection_id = value
        .get("connectionId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let display_name = value
        .get("displayName")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().chars().take(24).collect::<String>())
        .unwrap_or_else(|| "Anon".into());

    if !check_rate_limit(&state.rate, conn_id, "join").await {
        eprintln!("⚠️ Rate limit excedido en join");
        return Ok(());
    }

    if room_id.trim().is_empty() || room_id.len() > 128 || !is_valid_p256_pubkey(&public_key) {
        eprintln!("⚠️ Handshake incompleto");
        return Ok(());
    }

    let mut rooms = state.rooms.lock().await;
    let room = rooms.entry(room_id.clone()).or_insert_with(|| Room {
        clients: HashMap::new(),
        seen_connection_ids: HashSet::new(),
    });

    if room.clients.len() >= MAX_USERS_PER_ROOM {
        eprintln!("⚠️ Room llena: {room_id}");
        return Ok(());
    }

    *meta.room_id.lock().await = Some(room_id.clone());
    *meta.public_key.lock().await = Some(public_key.clone());
    *meta.display_name.lock().await = Some(display_name.clone());
    *meta.connection_id.lock().await = connection_id.clone();

    let is_reconnect = connection_id
        .as_ref()
        .map(|cid| room.seen_connection_ids.contains(cid))
        .unwrap_or(false);
    if let Some(cid) = &connection_id {
        room.seen_connection_ids.insert(cid.clone());
    }

    room.clients.insert(
        conn_id,
        ClientEntry {
            meta: meta.clone(),
            tx: tx.clone(),
        },
    );

    eprintln!(
        "✅ Cliente se unió a una room ({}/{}){}",
        room.clients.len(),
        MAX_USERS_PER_ROOM,
        if is_reconnect { " [reconexión]" } else { "" }
    );

    // Solo handshake ECDH cuando se empareja (1→2) y NO es reconexión.
    if room.clients.len() == 2 && !is_reconnect {
        // Intercambiar claves: a cada uno le mando la del otro.
        for (cid, entry) in room.clients.iter() {
            if *cid == conn_id {
                continue;
            }
            let peer_joined = serde_json::json!({
                "type": "peer_joined",
                "theirPublicKey": entry.meta.public_key.lock().await.clone().unwrap_or_default(),
                "theirDisplayName": entry.meta.display_name.lock().await.clone().unwrap_or_default(),
            });
            send_to(tx, &peer_joined);
            // Enviar al otro cliente la clave de este (conn_id).
            let back = serde_json::json!({
                "type": "peer_joined",
                "theirPublicKey": public_key,
                "theirDisplayName": display_name,
            });
            send_to(&entry.tx, &back);
        }
        eprintln!("👥 Room {room_id} activa (2/2 clientes)");
    }

    Ok(())
}

async fn handle_message(
    state: &Arc<AppState>,
    conn_id: usize,
    meta: &Arc<ClientMeta>,
    value: &Value,
) -> anyhow::Result<()> {
    let room_id = match &*meta.room_id.lock().await {
        Some(r) => r.clone(),
        None => {
            eprintln!("⚠️ Mensaje de cliente no unido a room");
            return Ok(());
        }
    };

    if !check_rate_limit(&state.rate, conn_id, "message").await {
        eprintln!("⚠️ Rate limit excedido en mensaje");
        return Ok(());
    }

    let iv = value.get("iv").and_then(|v| v.as_str()).unwrap_or("");
    let ciphertext = value.get("ciphertext").and_then(|v| v.as_str()).unwrap_or("");
    let counter = value.get("counter").and_then(|v| v.as_u64());

    if iv.is_empty()
        || ciphertext.is_empty()
        || !is_valid_base64(iv)
        || !is_valid_base64(ciphertext)
        || counter.is_none()
    {
        eprintln!("⚠️ Mensaje incompleto");
        return Ok(());
    }

    let rooms = state.rooms.lock().await;
    if let Some(room) = rooms.get(&room_id) {
        let sender_id = meta.connection_id.lock().await.clone();
        let response = serde_json::json!({
            "type": "message",
            "iv": iv,
            "ciphertext": ciphertext,
            "counter": counter.unwrap(),
            "senderId": sender_id,
        });
        // Broadcast a todos EXCEPTO el sender.
        for (cid, entry) in &room.clients {
            if *cid != conn_id {
                send_to(&entry.tx, &response);
            }
        }
    }
    Ok(())
}

async fn handle_typing(
    state: &Arc<AppState>,
    conn_id: usize,
    meta: &Arc<ClientMeta>,
    value: &Value,
) -> anyhow::Result<()> {
    if !check_rate_limit(&state.rate, conn_id, "message").await {
        return Ok(());
    }
    let is_typing = value.get("isTyping").and_then(|v| v.as_bool()).unwrap_or(false);
    let room_id = match &*meta.room_id.lock().await {
        Some(r) => r.clone(),
        None => return Ok(()),
    };
    let rooms = state.rooms.lock().await;
    if let Some(room) = rooms.get(&room_id) {
        let payload = serde_json::json!({"type": "typing", "isTyping": is_typing});
        for (cid, entry) in &room.clients {
            if *cid != conn_id {
                send_to(&entry.tx, &payload);
            }
        }
    }
    Ok(())
}

async fn handle_disconnect(state: &Arc<AppState>, conn_id: usize) {
    let mut rooms = state.rooms.lock().await;
    let mut room_to_update: Option<String> = None;
    for (rid, room) in rooms.iter_mut() {
        if room.clients.remove(&conn_id).is_some() {
            room_to_update = Some(rid.clone());
            break;
        }
    }
    if let Some(rid) = room_to_update {
        if let Some(room) = rooms.get(&rid) {
            if room.clients.is_empty() {
                rooms.remove(&rid);
                eprintln!("🗑️ Room {rid} eliminada (vacía)");
            } else {
                let peer_disc = serde_json::json!({"type": "peer_disconnected"});
                let typing_false = serde_json::json!({"type": "typing", "isTyping": false});
                for entry in room.clients.values() {
                    send_to(&entry.tx, &peer_disc);
                    send_to(&entry.tx, &typing_false);
                }
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let port = env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .or_else(|| {
            let args: Vec<String> = env::args().collect();
            let idx = args.iter().position(|a| a == "--port");
            idx.and_then(|i| args.get(i + 1)).and_then(|p| p.parse::<u16>().ok())
        })
        .unwrap_or(8080);

    run_server(port).await;
}

/// Arranca el relay escuchando en `port`. Extraído para poder ser invocado
/// desde tests de integración.
pub async fn run_server(port: u16) {
    let state = Arc::new(AppState {
        rooms: Arc::new(Mutex::new(HashMap::new())),
        rate: Arc::new(Mutex::new(HashMap::new())),
    });

    let listener = match TcpListener::bind(("127.0.0.1", port)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("❌ No se pudo enlazar el puerto {port}: {e}");
            std::process::exit(1);
        }
    };

    eprintln!("🚀 WindChat Relay (Rust) en puerto {port}");
    eprintln!("📡 WebSocket listo en ws://127.0.0.1:{port}");

    while let Ok((stream, _)) = listener.accept().await {
        let st = state.clone();
        tokio::spawn(async move {
            handle_connection(stream, st).await;
        });
    }
}

// ===== Tests de integración =====
#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    const DUMMY_KEY_A: &str = "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const DUMMY_KEY_B: &str = "BAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=";

    async fn connect(port: u16) -> (mpsc::UnboundedSender<String>, mpsc::UnboundedReceiver<String>) {
        let url = format!("ws://127.0.0.1:{port}");
        let (ws, _) = connect_async(url).await.expect("connect");
        let (mut writer, mut reader) = ws.split();
        let (tx, mut rx_in) = mpsc::unbounded_channel::<String>();
        let (tx_out, rx) = mpsc::unbounded_channel::<String>();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    msg = rx_in.recv() => {
                        match msg {
                            Some(s) => { if writer.send(Message::Text(s.into())).await.is_err() { break; } }
                            None => break,
                        }
                    }
                    msg = reader.next() => {
                        match msg {
                            Some(Ok(Message::Text(t))) => { if tx_out.send(t.to_string()).is_err() { break; } }
                            Some(Ok(_)) => {}
                            Some(Err(_)) | None => break,
                        }
                    }
                }
            }
        });
        (tx, rx)
    }

    async fn next_json(rx: &mut mpsc::UnboundedReceiver<String>) -> Value {
        let s = rx.recv().await.expect("mensaje");
        serde_json::from_str(&s).expect("json")
    }

    #[tokio::test]
    async fn eco_con_senderid_y_no_rehandshake_en_reconexion() {
        let port = 18180;
        tokio::spawn(run_server(port));

        let (_tx_a, mut rx_a) = connect(port).await;
        _tx_a.send(serde_json::to_string(&serde_json::json!({
            "type": "join", "roomId": "roomX", "publicKey": DUMMY_KEY_A, "connectionId": "connA"
        })).unwrap()).unwrap();

        let (tx_b, mut rx_b) = connect(port).await;
        tx_b.send(serde_json::to_string(&serde_json::json!({
            "type": "join", "roomId": "roomX", "publicKey": DUMMY_KEY_B, "connectionId": "connB"
        })).unwrap()).unwrap();

        let a_peer = next_json(&mut rx_a).await;
        assert_eq!(a_peer["type"], "peer_joined");
        assert_eq!(a_peer["theirPublicKey"], DUMMY_KEY_B);
        let b_peer = next_json(&mut rx_b).await;
        assert_eq!(b_peer["type"], "peer_joined");
        assert_eq!(b_peer["theirPublicKey"], DUMMY_KEY_A);

        _tx_a.send(serde_json::to_string(&serde_json::json!({
            "type": "message", "iv": "AAAAAAAAAAAAAAAAAAAAAA==", "ciphertext": "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            "counter": 1
        })).unwrap()).unwrap();

        let b_msg = next_json(&mut rx_b).await;
        assert_eq!(b_msg["type"], "message");
        assert_eq!(b_msg["senderId"], "connA");
        assert_eq!(b_msg["counter"], 1);

        let (tx_b2, mut rx_b2) = connect(port).await;
        tx_b2.send(serde_json::to_string(&serde_json::json!({
            "type": "join", "roomId": "roomX", "publicKey": DUMMY_KEY_B, "connectionId": "connB"
        })).unwrap()).unwrap();

        let recvd = tokio::time::timeout(std::time::Duration::from_millis(300), next_json(&mut rx_b2)).await;
        assert!(recvd.is_err(), "Reconexión no debe re-enviar peer_joined, pero llegó: {:?}", recvd.ok());
    }
}
