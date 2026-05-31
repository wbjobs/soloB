use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::Path;
use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::crdt::{TaskList, Task, TaskItem, Dot, ORSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredState {
    pub user_id: String,
    pub task_list: TaskList,
    pub version: u64,
}

pub struct FileStorage {
    data_dir: String,
}

impl FileStorage {
    pub fn new(data_dir: &str) -> Result<Self> {
        let path = Path::new(data_dir);
        if !path.exists() {
            fs::create_dir_all(path)?;
        }
        Ok(Self {
            data_dir: data_dir.to_string(),
        })
    }

    fn get_user_path(&self, user_id: &str) -> String {
        format!("{}/{}.json", self.data_dir, user_id)
    }

    pub fn load(&self, user_id: &str) -> Result<StoredState> {
        let path = self.get_user_path(user_id);
        if !Path::new(&path).exists() {
            return Ok(StoredState {
                user_id: user_id.to_string(),
                task_list: TaskList::new(),
                version: 0,
            });
        }

        let file = File::open(&path)?;
        let reader = BufReader::new(file);
        let state: StoredState = serde_json::from_reader(reader)?;
        Ok(state)
    }

    pub fn save(&self, state: &StoredState) -> Result<()> {
        let path = self.get_user_path(&state.user_id);
        let file = File::create(&path)?;
        let writer = BufWriter::new(file);
        serde_json::to_writer_pretty(writer, state)?;
        Ok(())
    }

    pub fn merge_and_save(
        &self,
        user_id: &str,
        incoming_task_list: &TaskList,
    ) -> Result<TaskList> {
        let mut stored = self.load(user_id)?;
        stored.task_list.merge(incoming_task_list);
        stored.version += 1;
        self.save(&stored)?;
        Ok(stored.task_list)
    }
}

pub fn create_task_item(content: String, completed: bool) -> TaskItem {
    use chrono::Utc;
    use uuid::Uuid;
    
    TaskItem {
        id: Uuid::new_v4().to_string(),
        content,
        completed,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

pub fn update_task_item(mut item: TaskItem, content: Option<String>, completed: Option<bool>) -> TaskItem {
    use chrono::Utc;
    
    if let Some(c) = content {
        item.content = c;
    }
    if let Some(c) = completed {
        item.completed = c;
    }
    item.updated_at = Utc::now();
    item
}

pub fn update_task(mut task: Task, title: Option<String>, description: Option<String>) -> Task {
    use chrono::Utc;
    
    if let Some(t) = title {
        task.title = t;
    }
    if task.description.is_some() || description.is_some() {
        task.description = description;
    }
    task.updated_at = Utc::now();
    task
}

pub fn generate_dot(replica_id: &str, counter: u64) -> Dot {
    Dot::new(replica_id, counter)
}
