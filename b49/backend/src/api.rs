use actix_web::{
    web,
    HttpResponse,
    Responder,
    http::StatusCode,
};
use serde::{Deserialize, Serialize};

use crate::crdt::{TaskList, Task, TaskItem, Dot};
use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncRequest {
    pub user_id: String,
    pub task_list: TaskList,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResponse {
    pub success: bool,
    pub task_list: TaskList,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetTasksRequest {
    pub user_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    pub user_id: String,
    pub title: String,
    pub description: Option<String>,
    pub dot: Dot,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateTaskRequest {
    pub user_id: String,
    pub task_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteTaskRequest {
    pub user_id: String,
    pub task_id: String,
    pub dot: Dot,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddTaskItemRequest {
    pub user_id: String,
    pub task_id: String,
    pub item: TaskItem,
    pub dot: Dot,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoveTaskItemRequest {
    pub user_id: String,
    pub task_id: String,
    pub item_id: String,
    pub dot: Dot,
}

pub async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "task-crdt-server"
    }))
}

pub async fn get_tasks(
    data: web::Data<AppState>,
    path: web::Path<String>,
) -> impl Responder {
    let user_id = path.into_inner();
    
    let storage = match data.storage.lock() {
        Ok(s) => s,
        Err(_) => {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "error": "Failed to lock storage" })
            );
        }
    };

    match storage.load(&user_id) {
        Ok(state) => HttpResponse::Ok().json(SyncResponse {
            success: true,
            task_list: state.task_list,
            message: None,
        }),
        Err(e) => HttpResponse::InternalServerError().json(
            serde_json::json!({ "error": format!("Failed to load tasks: {}", e) })
        ),
    }
}

pub async fn sync(
    data: web::Data<AppState>,
    body: web::Json<SyncRequest>,
) -> impl Responder {
    let SyncRequest { user_id, task_list } = body.into_inner();

    let storage = match data.storage.lock() {
        Ok(s) => s,
        Err(_) => {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "error": "Failed to lock storage" })
            );
        }
    };

    match storage.merge_and_save(&user_id, &task_list) {
        Ok(merged_list) => HttpResponse::Ok().json(SyncResponse {
            success: true,
            task_list: merged_list,
            message: Some("Sync successful".to_string()),
        }),
        Err(e) => HttpResponse::InternalServerError().json(
            serde_json::json!({ "error": format!("Failed to sync: {}", e) })
        ),
    }
}

pub async fn create_task(
    data: web::Data<AppState>,
    body: web::Json<CreateTaskRequest>,
) -> impl Responder {
    use crate::crdt::Task;
    
    let CreateTaskRequest { user_id, title, description, dot } = body.into_inner();

    let (new_task, _) = Task::new(title, description, &dot.replica_id);
    
    let mut storage = match data.storage.lock() {
        Ok(s) => s,
        Err(_) => {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "error": "Failed to lock storage" })
            );
        }
    };

    let mut state = match storage.load(&user_id) {
        Ok(s) => s,
        Err(e) => {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "error": format!("Failed to load state: {}", e) })
            );
        }
    };

    state.task_list.add_task(new_task.clone(), dot);
    state.version += 1;

    if let Err(e) = storage.save(&state) {
        return HttpResponse::InternalServerError().json(
            serde_json::json!({ "error": format!("Failed to save state: {}", e) })
        );
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "task": new_task,
        "message": "Task created successfully"
    }))
}

pub async fn delete_task(
    data: web::Data<AppState>,
    body: web::Json<DeleteTaskRequest>,
) -> impl Responder {
    let DeleteTaskRequest { user_id, task_id, dot } = body.into_inner();

    let mut storage = match data.storage.lock() {
        Ok(s) => s,
        Err(_) => {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "error": "Failed to lock storage" })
            );
        }
    };

    let mut state = match storage.load(&user_id) {
        Ok(s) => s,
        Err(e) => {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "error": format!("Failed to load state: {}", e) })
            );
        }
    };

    let task_to_remove = state.task_list.tasks.iter()
        .find(|t| t.id == task_id)
        .cloned();

    if let Some(task) = task_to_remove {
        state.task_list.remove_task(&task, dot);
        state.version += 1;

        if let Err(e) = storage.save(&state) {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "error": format!("Failed to save state: {}", e) })
            );
        }

        HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "message": "Task deleted successfully"
        }))
    } else {
        HttpResponse::NotFound().json(serde_json::json!({
            "success": false,
            "error": "Task not found"
        }))
    }
}

pub async fn add_task_item(
    data: web::Data<AppState>,
    body: web::Json<AddTaskItemRequest>,
) -> impl Responder {
    let AddTaskItemRequest { user_id, task_id, item, dot } = body.into_inner();

    let mut storage = match data.storage.lock() {
        Ok(s) => s,
        Err(_) => {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "error": "Failed to lock storage" })
            );
        }
    };

    let mut state = match storage.load(&user_id) {
        Ok(s) => s,
        Err(e) => {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "error": format!("Failed to load state: {}", e) })
            );
        }
    };

    let task_found = state.task_list.tasks.iter()
        .any(|t| t.id == task_id);

    if !task_found {
        return HttpResponse::NotFound().json(serde_json::json!({
            "success": false,
            "error": "Task not found"
        }));
    }

    let new_item = item.clone();
    
    let mut updated_tasks = Vec::new();
    for task in state.task_list.tasks.iter() {
        if task.id == task_id {
            let mut updated_task = task.clone();
            updated_task.add_item(item, dot);
            updated_tasks.push(updated_task);
        } else {
            updated_tasks.push(task.clone());
        }
    }

    use crate::crdt::ORSet;
    let mut new_task_set = ORSet::new();
    for task in updated_tasks {
        let dots = state.task_list.tasks.elements.get(&task).cloned().unwrap_or_default();
        for dot_item in dots {
            new_task_set.add(task.clone(), dot_item);
        }
    }
    state.task_list.tasks = new_task_set;
    state.version += 1;

    if let Err(e) = storage.save(&state) {
        return HttpResponse::InternalServerError().json(
            serde_json::json!({ "error": format!("Failed to save state: {}", e) })
        );
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "item": new_item,
        "message": "Task item added successfully"
    }))
}

pub async fn remove_task_item(
    data: web::Data<AppState>,
    body: web::Json<RemoveTaskItemRequest>,
) -> impl Responder {
    let RemoveTaskItemRequest { user_id, task_id, item_id, dot } = body.into_inner();

    let mut storage = match data.storage.lock() {
        Ok(s) => s,
        Err(_) => {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "error": "Failed to lock storage" })
            );
        }
    };

    let mut state = match storage.load(&user_id) {
        Ok(s) => s,
        Err(e) => {
            return HttpResponse::InternalServerError().json(
                serde_json::json!({ "error": format!("Failed to load state: {}", e) })
            );
        }
    };

    let mut updated_tasks = Vec::new();
    let mut item_found = false;
    
    for task in state.task_list.tasks.iter() {
        if task.id == task_id {
            if let Some(item_to_remove) = task.items.iter()
                .find(|i| i.id == item_id)
                .cloned() {
                let mut updated_task = task.clone();
                updated_task.remove_item(&item_to_remove, dot);
                updated_tasks.push(updated_task);
                item_found = true;
            } else {
                updated_tasks.push(task.clone());
            }
        } else {
            updated_tasks.push(task.clone());
        }
    }

    if !item_found {
        return HttpResponse::NotFound().json(serde_json::json!({
            "success": false,
            "error": "Task or item not found"
        }));
    }

    use crate::crdt::ORSet;
    let mut new_task_set = ORSet::new();
    for task in updated_tasks {
        let dots = state.task_list.tasks.elements.get(&task).cloned().unwrap_or_default();
        for dot_item in dots {
            new_task_set.add(task.clone(), dot_item);
        }
    }
    state.task_list.tasks = new_task_set;
    state.version += 1;

    if let Err(e) = storage.save(&state) {
        return HttpResponse::InternalServerError().json(
            serde_json::json!({ "error": format!("Failed to save state: {}", e) })
        );
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Task item removed successfully"
    }))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api")
            .route("/health", web::get().to(health_check))
            .route("/tasks/{user_id}", web::get().to(get_tasks))
            .route("/sync", web::post().to(sync))
            .route("/tasks/create", web::post().to(create_task))
            .route("/tasks/delete", web::delete().to(delete_task))
            .route("/tasks/items/add", web::post().to(add_task_item))
            .route("/tasks/items/remove", web::delete().to(remove_task_item))
    );
}
