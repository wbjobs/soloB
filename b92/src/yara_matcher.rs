use regex::Regex;
use std::collections::HashMap;
use thiserror::Error;
use super::{ExtractedScript, YaraMatch};

#[derive(Error, Debug)]
pub enum YaraMatcherError {
    #[error("Regex compilation error: {0}")]
    RegexError(#[from] regex::Error),
    
    #[error("Rule parsing error")]
    RuleParseError,
}

pub struct YaraScanResult {
    pub matches: Vec<YaraMatch>,
    pub additional_score: u32,
}

struct YaraRule {
    name: String,
    description: String,
    severity: String,
    score: u32,
    strings: Vec<Regex>,
    condition: YaraCondition,
}

enum YaraCondition {
    Any,
    All,
    AtLeast(usize),
}

pub struct YaraMatcher {
    rules: Vec<YaraRule>,
}

impl YaraMatcher {
    pub fn new() -> Result<Self, YaraMatcherError> {
        let mut matcher = YaraMatcher { rules: Vec::new() };
        matcher.load_default_rules()?;
        Ok(matcher)
    }

    fn load_default_rules(&mut self) -> Result<(), YaraMatcherError> {
        self.add_rule(
            "PDF_Malicious_JS_Basic",
            r#"
            description = "检测PDF中的基础恶意JavaScript模式"
            severity = "High"
            score = 25
            strings = [
                /app\.openDoc/i,
                /this\.openDoc/i,
                /util\.printd/i,
                /exportDataObject/i,
            ]
            condition = "any of them"
            "#,
        )?;

        self.add_rule(
            "PDF_Suspicious_Network",
            r#"
            description = "检测PDF中的网络活动"
            severity = "Medium"
            score = 20
            strings = [
                /XMLHttpRequest/i,
                /fetch\(/i,
                /websocket/i,
                /http:\/\//i,
                /https:\/\//i,
            ]
            condition = "any of them"
            "#,
        )?;

        self.add_rule(
            "PDF_Shell_Execute",
            r#"
            description = "检测PDF中的Shell执行"
            severity = "Critical"
            score = 45
            strings = [
                /shell\.Execute/i,
                /cmd\.exe/i,
                /powershell/i,
                /wscript/i,
                /cscript/i,
            ]
            condition = "any of them"
            "#,
        )?;

        self.add_rule(
            "PDF_Code_Obfuscation",
            r#"
            description = "检测PDF中的代码混淆"
            severity = "Medium"
            score = 15
            strings = [
                /eval\(/i,
                /fromCharCode/i,
                /charCodeAt/i,
                /\\x[0-9a-fA-F]{2}/,
                /\\u[0-9a-fA-F]{4}/,
            ]
            condition = "any of them"
            "#,
        )?;

        self.add_rule(
            "PDF_Registry_Access",
            r#"
            description = "检测PDF中的注册表访问"
            severity = "Critical"
            score = 40
            strings = [
                /Registry/i,
                /regOpenKey/i,
                /regSetValue/i,
                /HKEY_/i,
                /HKLM/i,
                /HKCU/i,
            ]
            condition = "any of them"
            "#,
        )?;

        self.add_rule(
            "PDF_File_System_Access",
            r#"
            description = "检测PDF中的文件系统访问"
            severity = "High"
            score = 30
            strings = [
                /WriteFile/i,
                /CreateFile/i,
                /DeleteFile/i,
                /FileSystemObject/i,
                /ADODB\.Stream/i,
            ]
            condition = "any of them"
            "#,
        )?;

        self.add_rule(
            "PDF_Process_Creation",
            r#"
            description = "检测PDF中的进程创建"
            severity = "Critical"
            score = 50
            strings = [
                /CreateProcess/i,
                /WinExec/i,
                /ShellExecute/i,
                /system\(/i,
                /popen/i,
            ]
            condition = "any of them"
            "#,
        )?;

        self.add_rule(
            "PDF_Downloader",
            r#"
            description = "检测PDF中的下载器行为"
            severity = "Critical"
            score = 45
            strings = [
                /URLDownloadToFile/i,
                /WinHttp/i,
                /InternetOpen/i,
                /InternetReadFile/i,
                /downloadFile/i,
            ]
            condition = "any of them"
            "#,
        )?;

        self.add_rule(
            "PDF_Auto_Open",
            r#"
            description = "检测PDF自动打开动作"
            severity = "Medium"
            score = 20
            strings = [
                /OpenAction/i,
                /AA\s*\[*/i,
                /autoOpen/i,
                /onOpen/i,
            ]
            condition = "any of them"
            "#,
        )?;

        self.add_rule(
            "PDF_Embedded_Malware",
            r#"
            description = "检测PDF中的嵌入式恶意软件"
            severity = "High"
            score = 35
            strings = [
                /EmbeddedFile.*\.exe/i,
                /EmbeddedFile.*\.dll/i,
                /EmbeddedFile.*\.bat/i,
                /EmbeddedFile.*\.vbs/i,
                /EmbeddedFile.*\.js/i,
            ]
            condition = "any of them"
            "#,
        )?;

        Ok(())
    }

    pub fn add_rule(&mut self, name: &str, rule_content: &str) -> Result<(), YaraMatcherError> {
        let parsed_rule = self.parse_rule(name, rule_content)?;
        self.rules.push(parsed_rule);
        Ok(())
    }

    fn parse_rule(&self, name: &str, rule_content: &str) -> Result<YaraRule, YaraMatcherError> {
        let mut description = String::new();
        let mut severity = "Medium".to_string();
        let mut score = 20;
        let mut strings = Vec::new();
        let mut condition = YaraCondition::Any;

        if let Some(desc_match) = Regex::new(r#"description\s*=\s*"([^"]+)""#)?.captures(rule_content) {
            description = desc_match[1].to_string();
        }

        if let Some(sev_match) = Regex::new(r#"severity\s*=\s*"([^"]+)""#)?.captures(rule_content) {
            severity = sev_match[1].to_string();
        }

        if let Some(score_match) = Regex::new(r"score\s*=\s*(\d+)")?.captures(rule_content) {
            score = score_match[1].parse().unwrap_or(20);
        }

        if let Some(strings_match) = Regex::new(r"strings\s*=\s*\[(.*?)\]")?.captures(rule_content) {
            let strings_content = &strings_match[1];
            for regex_str in strings_content.split(',') {
                let trimmed = regex_str.trim();
                if let Some(caps) = Regex::new(r"/(.+)/([a-z]*)")?.captures(trimmed) {
                    let pattern = &caps[1];
                    let flags = caps.get(2).map_or("", |m| m.as_str());
                    let regex_pattern = if flags.contains('i') {
                        format!("(?i){}", pattern)
                    } else {
                        pattern.to_string()
                    };
                    strings.push(Regex::new(&regex_pattern)?);
                }
            }
        }

        if let Some(cond_match) = Regex::new(r#"condition\s*=\s*"([^"]+)""#)?.captures(rule_content) {
            let cond_str = &cond_match[1];
            if cond_str.contains("all") {
                condition = YaraCondition::All;
            } else if cond_str.contains("any") {
                condition = YaraCondition::Any;
            } else if let Some(at_least) = Regex::new(r"at least (\d+)")?.captures(cond_str) {
                if let Ok(n) = at_least[1].parse() {
                    condition = YaraCondition::AtLeast(n);
                }
            }
        }

        Ok(YaraRule {
            name: name.to_string(),
            description,
            severity,
            score,
            strings,
            condition,
        })
    }

    pub fn scan_scripts(&self, scripts: &[ExtractedScript]) -> Result<YaraScanResult, YaraMatcherError> {
        let mut matches = Vec::new();
        let mut total_score = 0;
        let mut matched_rules: HashMap<String, bool> = HashMap::new();

        for script in scripts {
            for rule in &self.rules {
                if matched_rules.contains_key(&rule.name) {
                    continue;
                }

                let matched_strings = self.match_strings(&script.content, &rule.strings);
                let is_match = self.evaluate_condition(&matched_strings, &rule.condition);

                if is_match {
                    matched_rules.insert(rule.name.clone(), true);
                    total_score += rule.score;

                    matches.push(YaraMatch {
                        rule_name: rule.name.clone(),
                        description: rule.description.clone(),
                        matched_strings,
                        severity: rule.severity.clone(),
                    });
                }
            }
        }

        Ok(YaraScanResult {
            matches,
            additional_score: std::cmp::min(total_score, 100),
        })
    }

    fn match_strings(&self, content: &str, patterns: &[Regex]) -> Vec<String> {
        let mut results = Vec::new();
        for pattern in patterns {
            if let Some(captures) = pattern.find(content) {
                let matched = captures.as_str();
                let snippet = if matched.len() > 100 {
                    matched[..100].to_string()
                } else {
                    matched.to_string()
                };
                results.push(snippet);
            }
        }
        results
    }

    fn evaluate_condition(&self, matched_strings: &[String], condition: &YaraCondition) -> bool {
        match condition {
            YaraCondition::Any => !matched_strings.is_empty(),
            YaraCondition::All => matched_strings.len() >= self.rules.len(),
            YaraCondition::AtLeast(n) => matched_strings.len() >= *n,
        }
    }
}

impl Default for YaraMatcher {
    fn default() -> Self {
        Self::new().unwrap_or_else(|_| YaraMatcher { rules: Vec::new() })
    }
}
