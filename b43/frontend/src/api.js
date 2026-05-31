import { invoke } from "@tauri-apps/api/tauri";

const API_URL = "http://localhost:8080";

export async function getNotes() {
  try {
    const notes = await invoke("get_all_notes");
    console.log("Loaded notes:", notes.length);
    return notes;
  } catch (error) {
    console.error("Failed to get notes:", error);
    throw error;
  }
}

export async function createNote(title, content) {
  try {
    console.log("Creating note with title:", title);
    const note = await invoke("create_note", { title, content });
    console.log("Note created successfully:", note.id);
    return note;
  } catch (error) {
    console.error("Failed to create note:", error);
    throw error;
  }
}

export async function updateNote(id, title, content) {
  try {
    console.log("Updating note:", id);
    const note = await invoke("update_note", { id, title, content });
    console.log("Note updated successfully:", id);
    return note;
  } catch (error) {
    console.error("Failed to update note:", error);
    throw error;
  }
}

export async function deleteNote(id) {
  try {
    console.log("Deleting note:", id);
    await invoke("delete_note", { id });
    console.log("Note deleted successfully:", id);
  } catch (error) {
    console.error("Failed to delete note:", error);
    throw error;
  }
}

export async function getUnsyncedChanges() {
  try {
    const changes = await invoke("get_unsynced_changes");
    console.log("Unsynced changes:", changes.length);
    return changes;
  } catch (error) {
    console.error("Failed to get unsynced changes:", error);
    throw error;
  }
}

export async function markChangesSynced() {
  try {
    await invoke("mark_changes_synced");
    console.log("Changes marked as synced");
  } catch (error) {
    console.error("Failed to mark changes synced:", error);
    throw error;
  }
}

export async function applyServerChanges(changes) {
  try {
    console.log("Applying", changes.length, "server changes");
    await invoke("apply_server_changes", { changes });
    console.log("Server changes applied successfully");
  } catch (error) {
    console.error("Failed to apply server changes:", error);
    throw error;
  }
}

export async function getLastSync() {
  try {
    const timestamp = await invoke("get_last_sync");
    console.log("Last sync timestamp:", timestamp);
    return timestamp;
  } catch (error) {
    console.error("Failed to get last sync:", error);
    return new Date(0).toISOString();
  }
}

export async function setLastSync(timestamp) {
  try {
    await invoke("set_last_sync", { timestamp });
    console.log("Last sync timestamp set:", timestamp);
  } catch (error) {
    console.error("Failed to set last sync:", error);
    throw error;
  }
}

export async function getUserId() {
  try {
    return await invoke("get_user_id");
  } catch (error) {
    console.error("Failed to get user id:", error);
    return "local-user";
  }
}

function normalizeTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  if (typeof ts === "string") {
    return ts;
  }
  if (ts instanceof Date) {
    return ts.toISOString();
  }
  return new Date(ts).toISOString();
}

export async function syncWithServer() {
  try {
    const userId = await getUserId();
    const lastSync = await getLastSync();
    const localChanges = await getUnsyncedChanges();

    console.log("Syncing with server...");
    console.log("User ID:", userId);
    console.log("Last sync:", lastSync);
    console.log("Local changes count:", localChanges.length);

    const normalizedChanges = localChanges.map((change) => ({
      note_id: change.note_id,
      user_id: userId,
      operation: change.operation,
      timestamp: normalizeTimestamp(change.timestamp),
      title: change.title || "",
      content: change.content || "",
    }));

    console.log("Normalized changes:", JSON.stringify(normalizedChanges, null, 2));

    const requestBody = {
      user_id: userId,
      last_sync: normalizeTimestamp(lastSync),
      changes: normalizedChanges,
    };

    console.log("Request body:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${API_URL}/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    console.log("Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Sync error response:", errorText);
      throw new Error(`Sync failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log("Sync response:", JSON.stringify(data, null, 2));

    if (data.success) {
      console.log("Server changes received:", data.changes ? data.changes.length : 0);

      if (data.changes && data.changes.length > 0) {
        const normalizedServerChanges = data.changes.map((change) => ({
          note_id: change.note_id,
          user_id: change.user_id || userId,
          operation: change.operation,
          timestamp: normalizeTimestamp(change.timestamp),
          title: change.title || "",
          content: change.content || "",
        }));

        console.log("Applying normalized server changes:", normalizedServerChanges);
        await applyServerChanges(normalizedServerChanges);
      }

      if (localChanges.length > 0) {
        await markChangesSynced();
      }

      if (data.now) {
        await setLastSync(normalizeTimestamp(data.now));
      }

      console.log("Sync completed successfully");
      return true;
    }

    console.warn("Sync returned success=false");
    return false;
  } catch (error) {
    console.error("Sync failed with error:", error);
    throw error;
  }
}

export async function checkServerHealth() {
  try {
    console.log("Checking server health...");
    const response = await fetch(`${API_URL}/health`, {
      method: "GET",
    });
    const healthy = response.ok;
    console.log("Server health:", healthy ? "online" : "offline");
    return healthy;
  } catch (error) {
    console.log("Server health check failed (server offline):", error.message);
    return false;
  }
}

export async function getNoteHistory(noteId) {
  try {
    const userId = await getUserId();
    console.log("Fetching history for note:", noteId);
    
    const response = await fetch(`${API_URL}/notes/${noteId}/history?user_id=${encodeURIComponent(userId)}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch history: ${response.status}`);
    }

    const data = await response.json();
    console.log("History fetched:", data.history?.length || 0, "versions");
    return data.history || [];
  } catch (error) {
    console.error("Failed to get note history:", error);
    throw error;
  }
}

export async function rollbackToVersion(noteId, version) {
  try {
    const userId = await getUserId();
    console.log("Rolling back note", noteId, "to version", version);

    const response = await fetch(
      `${API_URL}/notes/${noteId}/rollback/${version}?user_id=${encodeURIComponent(userId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Rollback failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log("Rollback successful:", data.message);
    return data.note;
  } catch (error) {
    console.error("Failed to rollback:", error);
    throw error;
  }
}
