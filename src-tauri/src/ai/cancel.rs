//! Lets the frontend abort an in-flight `ai_agent_message` request (the
//! chat "stop" button). Keyed by a frontend-generated request id rather than
//! any window/tab identity, since the pairing is 1:1 with a single in-flight
//! `send()` call regardless of which tab or window it came from.
//!
//! A plain static registry (same precedent as aicompat::http's PROXY_URL)
//! rather than Tauri-managed state - nothing here needs an AppHandle, and it
//! sidesteps holding a `tauri::State` across the command's `.await`.

use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;

pub const CANCELLED: &str = "cancelled";

static PENDING: Mutex<Option<HashMap<String, oneshot::Sender<()>>>> = Mutex::new(None);

/// Registers `request_id` as cancellable and returns the receiver side to
/// race against the actual request future (see ai_agent_message).
pub fn register(request_id: String) -> oneshot::Receiver<()> {
    let (tx, rx) = oneshot::channel();
    PENDING
        .lock()
        .unwrap()
        .get_or_insert_with(HashMap::new)
        .insert(request_id, tx);
    rx
}

/// Drops the registration whether the request finished, failed, or was
/// itself the one that got cancelled - a stale entry would otherwise leak
/// for the lifetime of the app and let a reused id "cancel" a later request.
pub fn unregister(request_id: &str) {
    if let Some(map) = PENDING.lock().unwrap().as_mut() {
        map.remove(request_id);
    }
}

#[tauri::command]
pub fn ai_cancel(request_id: String) {
    if let Some(tx) = PENDING
        .lock()
        .unwrap()
        .as_mut()
        .and_then(|m| m.remove(&request_id))
    {
        let _ = tx.send(()); // receiver may already be gone if the request just finished on its own
    }
}
