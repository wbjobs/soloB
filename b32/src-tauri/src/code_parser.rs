use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeBlock {
    pub file_path: String,
    pub function_name: String,
    pub code: String,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedFile {
    pub path: String,
    pub language: String,
    pub blocks: Vec<CodeBlock>,
}

pub fn parse_directory(dir: &Path, progress_cb: impl Fn(usize, usize, &str)) -> Result<Vec<ParsedFile>> {
    let mut all_files: Vec<std::path::PathBuf> = Vec::new();
    
    for entry in WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if let Some(ext) = entry.path().extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if ["rs", "py", "js"].contains(&ext_str.as_str()) {
                    all_files.push(entry.path().to_path_buf());
                }
            }
        }
    }
    
    let total_files = all_files.len();
    let mut parsed_files = Vec::with_capacity(total_files);
    
    for (idx, file_path) in all_files.iter().enumerate() {
        progress_cb(idx + 1, total_files, file_path.to_string_lossy().as_ref());
        
        match parse_file(file_path) {
            Ok(parsed) => parsed_files.push(parsed),
            Err(e) => eprintln!("Warning: Failed to parse {:?}: {}", file_path, e),
        }
    }
    
    Ok(parsed_files)
}

pub fn parse_file(path: &Path) -> Result<ParsedFile> {
    let ext = path
        .extension()
        .context("File has no extension")?
        .to_string_lossy()
        .to_lowercase();
    
    let language = match ext.as_str() {
        "rs" => "rust",
        "py" => "python",
        "js" => "javascript",
        _ => return Err(anyhow::anyhow!("Unsupported file type: {}", ext)),
    };
    
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read file: {:?}", path))?;
    
    let blocks = extract_code_blocks(&content, language, &path.to_string_lossy())?;
    
    Ok(ParsedFile {
        path: path.to_string_lossy().to_string(),
        language: language.to_string(),
        blocks,
    })
}

fn extract_code_blocks(content: &str, language: &str, file_path: &str) -> Result<Vec<CodeBlock>> {
    let mut blocks = Vec::new();
    
    match language {
        "rust" => extract_rust_blocks(content, file_path, &mut blocks),
        "python" => extract_python_blocks(content, file_path, &mut blocks),
        "javascript" => extract_js_blocks(content, file_path, &mut blocks),
        _ => return Err(anyhow::anyhow!("Unsupported language: {}", language)),
    }
    
    Ok(blocks)
}

fn extract_rust_blocks(content: &str, file_path: &str, blocks: &mut Vec<CodeBlock>) {
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;
    
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_start();
        
        if trimmed.starts_with("fn ") || 
           trimmed.starts_with("pub fn ") || 
           trimmed.starts_with("async fn ") || 
           trimmed.starts_with("pub async fn ") {
            if let Some(block) = extract_brace_block(&lines, i, file_path, "rust") {
                blocks.push(block);
                i = block_end_line(&lines, i) + 1;
                continue;
            }
        }
        
        if trimmed.starts_with("struct ") || 
           trimmed.starts_with("pub struct ") || 
           trimmed.starts_with("impl ") || 
           trimmed.starts_with("trait ") || 
           trimmed.starts_with("pub trait ") {
            if let Some(block) = extract_brace_block(&lines, i, file_path, "rust") {
                blocks.push(block);
                i = block_end_line(&lines, i) + 1;
                continue;
            }
        }
        
        i += 1;
    }
}

fn extract_python_blocks(content: &str, file_path: &str, blocks: &mut Vec<CodeBlock>) {
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;
    
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_start();
        
        if trimmed.starts_with("def ") || 
           trimmed.starts_with("async def ") || 
           trimmed.starts_with("class ") {
            let block = extract_python_indent_block(&lines, i, file_path);
            blocks.push(block);
            i = block_end_line_python(&lines, i) + 1;
            continue;
        }
        
        i += 1;
    }
}

fn extract_js_blocks(content: &str, file_path: &str, blocks: &mut Vec<CodeBlock>) {
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;
    
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_start();
        
        if trimmed.starts_with("function ") || 
           trimmed.starts_with("async function ") || 
           trimmed.starts_with("class ") ||
           trimmed.contains("=> {") ||
           trimmed.starts_with("export function ") ||
           trimmed.starts_with("export async function ") ||
           trimmed.starts_with("export class ") {
            if let Some(block) = extract_brace_block(&lines, i, file_path, "javascript") {
                blocks.push(block);
                i = block_end_line(&lines, i) + 1;
                continue;
            }
        }
        
        if trimmed.starts_with("const ") && trimmed.contains("=>") ||
           trimmed.starts_with("let ") && trimmed.contains("=>") ||
           trimmed.starts_with("var ") && trimmed.contains("=>") {
            if let Some(block) = extract_brace_block(&lines, i, file_path, "javascript") {
                blocks.push(block);
                i = block_end_line(&lines, i) + 1;
                continue;
            }
        }
        
        i += 1;
    }
}

fn extract_brace_block(lines: &[&str], start_line: usize, file_path: &str, language: &str) -> Option<CodeBlock> {
    let start_content = lines[start_line];
    let function_name = extract_name(start_content);
    
    let mut depth = 0;
    let mut found_start = false;
    let mut end_line = start_line;
    let mut collected_lines = Vec::new();
    
    for (idx, line) in lines.iter().enumerate().skip(start_line) {
        collected_lines.push(*line);
        end_line = idx;
        
        for c in line.chars() {
            match c {
                '{' => {
                    depth += 1;
                    found_start = true;
                }
                '}' => {
                    depth -= 1;
                    if found_start && depth == 0 {
                        break;
                    }
                }
                _ => {}
            }
        }
        
        if found_start && depth == 0 {
            break;
        }
    }
    
    if !found_start || depth != 0 {
        return None;
    }
    
    let code = collected_lines.join("\n");
    
    Some(CodeBlock {
        file_path: file_path.to_string(),
        function_name,
        code,
        language: language.to_string(),
    })
}

fn extract_python_indent_block(lines: &[&str], start_line: usize, file_path: &str) -> CodeBlock {
    let start_content = lines[start_line];
    let function_name = extract_name_python(start_content);
    
    let base_indent = get_indent_level(lines[start_line]);
    let mut end_line = start_line;
    let mut collected_lines = vec![lines[start_line]];
    
    for (idx, line) in lines.iter().enumerate().skip(start_line + 1) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            collected_lines.push(*line);
            continue;
        }
        
        let indent = get_indent_level(line);
        if indent <= base_indent && !trimmed.starts_with('#') {
            break;
        }
        
        collected_lines.push(*line);
        end_line = idx;
    }
    
    let code = collected_lines.join("\n");
    
    CodeBlock {
        file_path: file_path.to_string(),
        function_name,
        code,
        language: "python".to_string(),
    }
}

fn extract_name(line: &str) -> String {
    let trimmed = line.trim_start();
    
    let patterns = [
        "pub async fn ", "async fn ", "pub fn ", "fn ",
        "pub struct ", "struct ", "pub trait ", "trait ",
        "impl ", "enum ", "pub enum ",
        "async function ", "function ", "class ",
        "export async function ", "export function ", "export class ",
    ];
    
    for pattern in patterns {
        if let Some(rest) = trimmed.strip_prefix(pattern) {
            if let Some(end) = rest.find(|c: char| !c.is_alphanumeric() && c != '_') {
                return rest[..end].to_string();
            }
            return rest.to_string();
        }
    }
    
    if trimmed.contains("=>") {
        if let Some(eq_idx) = trimmed.find('=') {
            let before_eq = &trimmed[..eq_idx];
            let name = before_eq
                .split_whitespace()
                .last()
                .unwrap_or("anonymous");
            return name.trim_matches(|c: char| !c.is_alphanumeric() && c != '_').to_string();
        }
    }
    
    "anonymous".to_string()
}

fn extract_name_python(line: &str) -> String {
    let trimmed = line.trim_start();
    
    let patterns = ["async def ", "def ", "class "];
    
    for pattern in patterns {
        if let Some(rest) = trimmed.strip_prefix(pattern) {
            if let Some(end) = rest.find('(') {
                return rest[..end].trim().to_string();
            }
            if let Some(end) = rest.find(':') {
                return rest[..end].trim().to_string();
            }
            return rest.to_string();
        }
    }
    
    "anonymous".to_string()
}

fn get_indent_level(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

fn block_end_line(lines: &[&str], start_line: usize) -> usize {
    let mut depth = 0;
    let mut found_start = false;
    
    for (idx, line) in lines.iter().enumerate().skip(start_line) {
        for c in line.chars() {
            match c {
                '{' => {
                    depth += 1;
                    found_start = true;
                }
                '}' => {
                    depth -= 1;
                    if found_start && depth == 0 {
                        return idx;
                    }
                }
                _ => {}
            }
        }
    }
    
    lines.len() - 1
}

fn block_end_line_python(lines: &[&str], start_line: usize) -> usize {
    let base_indent = get_indent_level(lines[start_line]);
    
    for (idx, line) in lines.iter().enumerate().skip(start_line + 1) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        
        let indent = get_indent_level(line);
        if indent <= base_indent && !trimmed.starts_with('#') {
            return idx - 1;
        }
    }
    
    lines.len() - 1
}
