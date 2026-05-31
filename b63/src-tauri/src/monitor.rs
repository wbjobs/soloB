use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, TryLockError};
use sysinfo::{CpuExt, DiskExt, NetworkExt, NetworksExt, Pid, ProcessExt, System, SystemExt};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetrics {
    pub cpu_usage: f32,
    pub cpu_cores: usize,
    pub memory_total: u64,
    pub memory_used: u64,
    pub memory_percent: f32,
    pub swap_total: u64,
    pub swap_used: u64,
    pub disks: Vec<DiskInfo>,
    pub network: NetworkInfo,
    pub uptime: u64,
    pub process_count: usize,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub total_space: u64,
    pub used_space: u64,
    pub available_space: u64,
    pub used_percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInfo {
    pub total_received: u64,
    pub total_transmitted: u64,
    pub interfaces: Vec<NetworkInterface>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterface {
    pub name: String,
    pub received: u64,
    pub transmitted: u64,
    pub receive_speed: f64,
    pub transmit_speed: f64,
}

pub struct MonitorState {
    pub system: Arc<Mutex<System>>,
    pub network_prev: Arc<Mutex<std::collections::HashMap<String, (u64, u64)>>>,
    pub cached_metrics: Arc<Mutex<Option<SystemMetrics>>>,
    pub is_initialized: Arc<Mutex<bool>>,
}

impl MonitorState {
    pub fn new() -> Self {
        MonitorState {
            system: Arc::new(Mutex::new(System::new())),
            network_prev: Arc::new(Mutex::new(std::collections::HashMap::new())),
            cached_metrics: Arc::new(Mutex::new(None)),
            is_initialized: Arc::new(Mutex::new(false)),
        }
    }
}

pub fn create_fallback_metrics() -> SystemMetrics {
    SystemMetrics {
        cpu_usage: 0.0,
        cpu_cores: 0,
        memory_total: 0,
        memory_used: 0,
        memory_percent: 0.0,
        swap_total: 0,
        swap_used: 0,
        disks: vec![],
        network: NetworkInfo {
            total_received: 0,
            total_transmitted: 0,
            interfaces: vec![],
        },
        uptime: 0,
        process_count: 0,
        timestamp: chrono::Utc::now().timestamp(),
    }
}

fn refresh_cpu_memory_network(sys: &mut System) {
    sys.refresh_cpu();
    sys.refresh_memory();
    sys.refresh_networks_list();
    sys.refresh_networks();
}

fn refresh_disks(sys: &mut System) {
    sys.refresh_disks_list();
    sys.refresh_disks();
}

fn refresh_all_fast(sys: &mut System) {
    refresh_cpu_memory_network(sys);
}

pub fn collect_metrics_fast(state: &MonitorState) -> Option<SystemMetrics> {
    let sys_guard = match state.system.try_lock() {
        Ok(g) => g,
        Err(TryLockError::WouldBlock) => return None,
        Err(TryLockError::Poisoned(_)) => return None,
    };
    
    let initialized = match state.is_initialized.try_lock() {
        Ok(g) => *g,
        Err(_) => false,
    };
    
    if !initialized {
        return None;
    }
    
    let mut sys = sys_guard;
    refresh_all_fast(&mut sys);
    
    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let cpu_cores = sys.cpus().len();
    let memory_total = sys.total_memory();
    let memory_used = sys.used_memory();
    let memory_percent = if memory_total > 0 {
        (memory_used as f64 / memory_total as f64 * 100.0) as f32
    } else {
        0.0
    };
    let swap_total = sys.total_swap();
    let swap_used = sys.used_swap();
    let uptime = sys.uptime();
    let process_count = sys.processes().len();
    
    let networks = sys.networks();
    let mut network_prev = match state.network_prev.try_lock() {
        Ok(g) => g,
        Err(_) => std::collections::HashMap::new(),
    };
    
    let mut total_received = 0u64;
    let mut total_transmitted = 0u64;
    
    let interfaces: Vec<NetworkInterface> = networks
        .iter()
        .map(|(name, network)| {
            let received = network.received();
            let transmitted = network.transmitted();
            total_received += received;
            total_transmitted += transmitted;
            
            let (prev_rx, prev_tx) = network_prev
                .get(name)
                .copied()
                .unwrap_or((received, transmitted));
            
            let receive_speed = if prev_rx <= received {
                (received - prev_rx) as f64
            } else {
                0.0
            };
            let transmit_speed = if prev_tx <= transmitted {
                (transmitted - prev_tx) as f64
            } else {
                0.0
            };
            
            network_prev.insert(name.clone(), (received, transmitted));
            
            NetworkInterface {
                name: name.clone(),
                received,
                transmitted,
                receive_speed,
                transmit_speed,
            }
        })
        .collect();
    
    let cached = state.cached_metrics.try_lock();
    let disks = if let Ok(ref cache_guard) = cached {
        if let Some(ref cached_m) = **cache_guard {
            cached_m.disks.clone()
        } else {
            vec![]
        }
    } else {
        vec![]
    };
    
    Some(SystemMetrics {
        cpu_usage,
        cpu_cores,
        memory_total,
        memory_used,
        memory_percent,
        swap_total,
        swap_used,
        disks,
        network: NetworkInfo {
            total_received,
            total_transmitted,
            interfaces,
        },
        uptime,
        process_count,
        timestamp: chrono::Utc::now().timestamp(),
    })
}

pub fn collect_metrics_with_disks(state: &MonitorState) -> Option<SystemMetrics> {
    let sys_guard = match state.system.try_lock() {
        Ok(g) => g,
        Err(TryLockError::WouldBlock) => return None,
        Err(TryLockError::Poisoned(_)) => return None,
    };
    
    let initialized = match state.is_initialized.try_lock() {
        Ok(g) => *g,
        Err(_) => false,
    };
    
    if !initialized {
        return None;
    }
    
    let mut sys = sys_guard;
    refresh_cpu_memory_network(&mut sys);
    refresh_disks(&mut sys);
    
    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let cpu_cores = sys.cpus().len();
    let memory_total = sys.total_memory();
    let memory_used = sys.used_memory();
    let memory_percent = if memory_total > 0 {
        (memory_used as f64 / memory_total as f64 * 100.0) as f32
    } else {
        0.0
    };
    let swap_total = sys.total_swap();
    let swap_used = sys.used_swap();
    let uptime = sys.uptime();
    let process_count = sys.processes().len();
    
    let disks: Vec<DiskInfo> = sys
        .disks()
        .iter()
        .map(|disk| {
            let total = disk.total_space();
            let used = total.saturating_sub(disk.available_space());
            DiskInfo {
                name: disk.name().to_string_lossy().to_string(),
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                file_system: String::from_utf8_lossy(disk.file_system()).to_string(),
                total_space: total,
                used_space: used,
                available_space: disk.available_space(),
                used_percent: if total > 0 {
                    (used as f64 / total as f64 * 100.0) as f32
                } else {
                    0.0
                },
            }
        })
        .collect();
    
    let networks = sys.networks();
    let mut network_prev = match state.network_prev.try_lock() {
        Ok(g) => g,
        Err(_) => std::collections::HashMap::new(),
    };
    
    let mut total_received = 0u64;
    let mut total_transmitted = 0u64;
    
    let interfaces: Vec<NetworkInterface> = networks
        .iter()
        .map(|(name, network)| {
            let received = network.received();
            let transmitted = network.transmitted();
            total_received += received;
            total_transmitted += transmitted;
            
            let (prev_rx, prev_tx) = network_prev
                .get(name)
                .copied()
                .unwrap_or((received, transmitted));
            
            let receive_speed = if prev_rx <= received {
                (received - prev_rx) as f64
            } else {
                0.0
            };
            let transmit_speed = if prev_tx <= transmitted {
                (transmitted - prev_tx) as f64
            } else {
                0.0
            };
            
            network_prev.insert(name.clone(), (received, transmitted));
            
            NetworkInterface {
                name: name.clone(),
                received,
                transmitted,
                receive_speed,
                transmit_speed,
            }
        })
        .collect();
    
    Some(SystemMetrics {
        cpu_usage,
        cpu_cores,
        memory_total,
        memory_used,
        memory_percent,
        swap_total,
        swap_used,
        disks,
        network: NetworkInfo {
            total_received,
            total_transmitted,
            interfaces,
        },
        uptime,
        process_count,
        timestamp: chrono::Utc::now().timestamp(),
    })
}

pub fn initialize_monitor(state: &MonitorState) -> Result<(), String> {
    let mut sys = state.system.lock().map_err(|e| e.to_string())?;
    *sys = System::new_all();
    sys.refresh_all();
    
    let mut initialized = state.is_initialized.lock().map_err(|e| e.to_string())?;
    *initialized = true;
    
    Ok(())
}

pub fn get_cached_metrics(state: &MonitorState) -> SystemMetrics {
    if let Ok(cache_guard) = state.cached_metrics.try_lock() {
        if let Some(ref cached) = *cache_guard {
            return cached.clone();
        }
    }
    create_fallback_metrics()
}

pub fn set_cached_metrics(state: &MonitorState, metrics: SystemMetrics) {
    if let Ok(mut cache_guard) = state.cached_metrics.try_lock() {
        *cache_guard = Some(metrics);
    }
}

pub async fn start_monitoring(app: AppHandle, state: Arc<MonitorState>) {
    if let Err(e) = initialize_monitor(&state) {
        eprintln!("[monitor] 初始化失败: {}", e);
        let fallback = create_fallback_metrics();
        set_cached_metrics(&state, fallback.clone());
        let _ = app.emit("metrics-update", fallback);
        return;
    }
    
    if let Some(initial) = collect_metrics_with_disks(&state) {
        set_cached_metrics(&state, initial.clone());
        let _ = app.emit("metrics-update", initial);
    }
    
    let mut fast_count = 0u32;
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    
    loop {
        interval.tick().await;
        fast_count += 1;
        
        if fast_count >= 5 {
            fast_count = 0;
            if let Some(metrics) = collect_metrics_with_disks(&state) {
                set_cached_metrics(&state, metrics.clone());
                let _ = app.emit("metrics-update", metrics);
                continue;
            }
        }
        
        if let Some(metrics) = collect_metrics_fast(&state) {
            let mut to_emit = metrics.clone();
            if to_emit.disks.is_empty() {
                if let Ok(cache_guard) = state.cached_metrics.try_lock() {
                    if let Some(ref cached) = *cache_guard {
                        to_emit.disks = cached.disks.clone();
                    }
                }
            }
            let _ = app.emit("metrics-update", to_emit);
        } else {
            if let Ok(cache_guard) = state.cached_metrics.try_lock() {
                if let Some(ref cached) = *cache_guard {
                    let mut copy = cached.clone();
                    copy.timestamp = chrono::Utc::now().timestamp();
                    let _ = app.emit("metrics-update", copy);
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: Option<u32>,
    pub name: String,
    pub exe: String,
    pub cmd: Vec<String>,
    pub cpu_usage: f32,
    pub memory: u64,
    pub virtual_memory: u64,
    pub status: String,
    pub start_time: u64,
    pub run_time: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessTreeNode {
    pub info: ProcessInfo,
    pub children: Vec<ProcessTreeNode>,
}

pub fn collect_process_list(state: &MonitorState) -> Option<Vec<ProcessInfo>> {
    let sys_guard = match state.system.try_lock() {
        Ok(g) => g,
        Err(_) => return None,
    };

    let initialized = match state.is_initialized.try_lock() {
        Ok(g) => *g,
        Err(_) => false,
    };

    if !initialized {
        return None;
    }

    let mut sys = sys_guard;
    sys.refresh_processes();

    let processes: Vec<ProcessInfo> = sys
        .processes()
        .iter()
        .map(|(pid, process)| {
            let ppid = process.parent().map(|p| p.as_u32());
            
            ProcessInfo {
                pid: pid.as_u32(),
                ppid,
                name: process.name().to_string(),
                exe: process.exe().map_or(String::new(), |p| p.to_string_lossy().to_string()),
                cmd: process.cmd().iter().map(|s| s.to_string()).collect(),
                cpu_usage: process.cpu_usage(),
                memory: process.memory(),
                virtual_memory: process.virtual_memory(),
                status: format!("{:?}", process.status()),
                start_time: process.start_time(),
                run_time: process.run_time(),
            }
        })
        .collect();

    Some(processes)
}

pub fn build_process_tree(processes: Vec<ProcessInfo>) -> Vec<ProcessTreeNode> {
    let mut pid_map: HashMap<u32, ProcessInfo> = HashMap::new();
    let mut parent_map: HashMap<Option<u32>, Vec<u32>> = HashMap::new();
    let mut existing_pids: HashSet<u32> = HashSet::new();

    for proc in &processes {
        existing_pids.insert(proc.pid);
    }

    for proc in processes {
        let ppid = proc.ppid.filter(|&p| existing_pids.contains(&p));
        let pid = proc.pid;
        pid_map.insert(pid, proc);
        parent_map.entry(ppid).or_insert_with(Vec::new).push(pid);
    }

    fn build_tree(
        ppid: Option<u32>,
        pid_map: &HashMap<u32, ProcessInfo>,
        parent_map: &HashMap<Option<u32>, Vec<u32>>,
    ) -> Vec<ProcessTreeNode> {
        let mut nodes: Vec<ProcessTreeNode> = Vec::new();
        if let Some(children) = parent_map.get(&ppid) {
            for pid in children {
                if let Some(info) = pid_map.get(pid) {
                    nodes.push(ProcessTreeNode {
                        info: info.clone(),
                        children: build_tree(Some(*pid), pid_map, parent_map),
                    });
                }
            }
        }
        nodes.sort_by(|a, b| a.info.name.cmp(&b.info.name));
        nodes
    }

    let mut result: Vec<ProcessTreeNode> = Vec::new();
    for proc in pid_map.values() {
        if proc.ppid.is_none() || !existing_pids.contains(&proc.ppid.unwrap_or(0)) {
            let children = build_tree(Some(proc.pid), &pid_map, &parent_map);
            result.push(ProcessTreeNode {
                info: proc.clone(),
                children,
            });
        }
    }

    result.sort_by(|a, b| {
        let cmp = b.info.cpu_usage.partial_cmp(&a.info.cpu_usage);
        cmp.unwrap_or(std::cmp::Ordering::Equal)
    });

    result
}

pub fn collect_process_tree(state: &MonitorState) -> Option<Vec<ProcessTreeNode>> {
    collect_process_list(state).map(build_process_tree)
}

pub fn kill_process(pid: u32) -> Result<(), String> {
    let mut sys = System::new();
    sys.refresh_processes();
    
    let target_pid = Pid::from(pid as usize);
    
    if let Some(process) = sys.process(target_pid) {
        if process.kill() {
            Ok(())
        } else {
            Err(format!("无法终止进程 PID: {}", pid))
        }
    } else {
        Err(format!("未找到进程 PID: {}", pid))
    }
}

pub fn format_bytes_kb(bytes: u64) -> String {
    if bytes == 0 {
        return "0 KB".to_string();
    }
    let kb = bytes / 1024;
    if kb < 1024 {
        format!("{} KB", kb)
    } else {
        let mb = kb as f64 / 1024.0;
        if mb < 1024.0 {
            format!("{:.1} MB", mb)
        } else {
            let gb = mb / 1024.0;
            format!("{:.2} GB", gb)
        }
    }
}

pub fn format_duration(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{}:{:02}", minutes, secs)
    }
}

