use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Dot {
    pub replica_id: String,
    pub counter: u64,
}

impl Dot {
    pub fn new(replica_id: &str, counter: u64) -> Self {
        Self {
            replica_id: replica_id.to_string(),
            counter,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ORSet<T>
where
    T: std::hash::Hash + Eq + Clone + Serialize + for<'de> Deserialize<'de>,
{
    pub elements: HashMap<T, HashSet<Dot>>,
    pub tombstones: HashMap<T, HashSet<Dot>>,
}

impl<T> ORSet<T>
where
    T: std::hash::Hash + Eq + Clone + Serialize + for<'de> Deserialize<'de>,
{
    pub fn new() -> Self {
        Self {
            elements: HashMap::new(),
            tombstones: HashMap::new(),
        }
    }

    pub fn add(&mut self, value: T, dot: Dot) {
        self.elements
            .entry(value)
            .or_insert_with(HashSet::new)
            .insert(dot);
    }

    pub fn remove(&mut self, value: T, dot: Dot) {
        if let Some(dots) = self.elements.remove(&value) {
            let tombstones = self
                .tombstones
                .entry(value)
                .or_insert_with(HashSet::new);
            tombstones.extend(dots);
            tombstones.insert(dot);
        }
    }

    pub fn contains(&self, value: &T) -> bool {
        self.elements.contains_key(value)
    }

    pub fn iter(&self) -> impl Iterator<Item = &T> {
        self.elements.keys()
    }

    pub fn len(&self) -> usize {
        self.elements.len()
    }

    pub fn is_empty(&self) -> bool {
        self.elements.is_empty()
    }

    pub fn merge(&mut self, other: &Self) {
        for (elem, dots) in &other.elements {
            let entry = self
                .elements
                .entry(elem.clone())
                .or_insert_with(HashSet::new);
            entry.extend(dots.iter().cloned());
        }

        for (elem, dots) in &other.tombstones {
            let tombstone_entry = self
                .tombstones
                .entry(elem.clone())
                .or_insert_with(HashSet::new);
            tombstone_entry.extend(dots.iter().cloned());
        }

        let elements_keys: Vec<T> = self.elements.keys().cloned().collect();
        for elem in elements_keys {
            if let Some(tombstone_dots) = self.tombstones.get(&elem) {
                if let Some(element_dots) = self.elements.get(&elem) {
                    if tombstone_dots.is_superset(element_dots) {
                        self.elements.remove(&elem);
                    }
                }
            }
        }
    }
}

impl<T> Default for ORSet<T>
where
    T: std::hash::Hash + Eq + Clone + Serialize + for<'de> Deserialize<'de>,
{
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskItem {
    pub id: String,
    pub content: String,
    pub completed: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub items: ORSet<TaskItem>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Task {
    pub fn new(title: String, description: Option<String>, replica_id: &str) -> (Self, Dot) {
        let now = Utc::now();
        let task = Self {
            id: Uuid::new_v4().to_string(),
            title,
            description,
            items: ORSet::new(),
            created_at: now,
            updated_at: now,
        };
        let dot = Dot::new(replica_id, 0);
        (task, dot)
    }

    pub fn add_item(&mut self, item: TaskItem, dot: Dot) {
        self.items.add(item, dot);
        self.updated_at = Utc::now();
    }

    pub fn remove_item(&mut self, item: &TaskItem, dot: Dot) {
        self.items.remove(item.clone(), dot);
        self.updated_at = Utc::now();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskList {
    pub tasks: ORSet<Task>,
    pub last_sync_at: Option<DateTime<Utc>>,
}

impl TaskList {
    pub fn new() -> Self {
        Self {
            tasks: ORSet::new(),
            last_sync_at: None,
        }
    }

    pub fn add_task(&mut self, task: Task, dot: Dot) {
        self.tasks.add(task, dot);
    }

    pub fn remove_task(&mut self, task: &Task, dot: Dot) {
        self.tasks.remove(task.clone(), dot);
    }

    pub fn merge(&mut self, other: &Self) {
        self.tasks.merge(&other.tasks);
        self.last_sync_at = Some(Utc::now());
    }

    pub fn get_task(&self, task_id: &str) -> Option<&Task> {
        self.tasks.iter().find(|t| t.id == task_id)
    }
}

impl Default for TaskList {
    fn default() -> Self {
        Self::new()
    }
}
