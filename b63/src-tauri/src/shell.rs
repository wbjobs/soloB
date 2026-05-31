use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellOutput {
    pub output: String,
    pub error: String,
    pub exit_code: Option<i32>,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellStreamEvent {
    pub id: String,
    pub output: String,
    pub is_error: bool,
    pub is_end: bool,
    pub exit_code: Option<i32>,
}

pub struct ActiveShell {
    pub id: String,
    pub sender: mpsc::Sender<String>,
}

pub struct ShellManager {
    pub active_shells: Arc<Mutex<Vec<ActiveShell>>>,
}

impl ShellManager {
    pub fn new() -> Self {
        ShellManager {
            active_shells: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

fn get_platform_shell() -> (&'static str, &'static [&'static str]) {
    #[cfg(target_os = "windows")]
    {
        ("powershell", &["-Command"])
    }
    #[cfg(target_os = "macos")]
    {
        ("/bin/zsh", &["-c"])
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        ("/bin/bash", &["-c"])
    }
}

pub fn execute_shell_command_sync(command: &str) -> ShellOutput {
    let (shell, args) = get_platform_shell();
    
    let result = Command::new(shell)
        .args(args)
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    
    match result {
        Ok(mut child) => {
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            
            let mut output = String::new();
            let mut error = String::new();
            
            if let Some(stdout) = stdout {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        output.push_str(&line);
                        output.push('\n');
                    }
                }
            }
            
            if let Some(stderr) = stderr {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        error.push_str(&line);
                        error.push('\n');
                    }
                }
            }
            
            let status = child.wait();
            
            ShellOutput {
                output,
                error,
                exit_code: status.ok().and_then(|s| s.code()),
                completed: true,
            }
        }
        Err(e) => ShellOutput {
            output: String::new(),
            error: format!("执行错误: {}", e),
            exit_code: None,
            completed: true,
        },
    }
}

pub async fn execute_shell_command_async(
    app: tauri::AppHandle,
    command: String,
    session_id: String,
) {
    let (shell, args) = get_platform_shell();
    
    let result = tokio::task::spawn_blocking(move || {
        let mut child = Command::new(shell)
            .args(args)
            .arg(&command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        
        match child {
            Ok(ref mut child) => {
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                
                if let Some(stdout) = stdout {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            let _ = app.emit(
                                "shell-output",
                                ShellStreamEvent {
                                    id: session_id.clone(),
                                    output: format!("{}\n", line),
                                    is_error: false,
                                    is_end: false,
                                    exit_code: None,
                                },
                            );
                        }
                    }
                }
                
                if let Some(stderr) = stderr {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            let _ = app.emit(
                                "shell-output",
                                ShellStreamEvent {
                                    id: session_id.clone(),
                                    output: format!("{}\n", line),
                                    is_error: true,
                                    is_end: false,
                                    exit_code: None,
                                },
                            );
                        }
                    }
                }
                
                let status = child.wait();
                let exit_code = status.ok().and_then(|s| s.code());
                
                let _ = app.emit(
                    "shell-output",
                    ShellStreamEvent {
                        id: session_id,
                        output: String::new(),
                        is_error: false,
                        is_end: true,
                        exit_code,
                    },
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "shell-output",
                    ShellStreamEvent {
                        id: session_id,
                        output: format!("执行错误: {}\n", e),
                        is_error: true,
                        is_end: true,
                        exit_code: None,
                    },
                );
            }
        }
    });
    
    let _ = result.await;
}
