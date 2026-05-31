mod pdf_parser;
mod malware_detector;
mod yara_matcher;

use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

pub use pdf_parser::PdfParser;
pub use malware_detector::MalwareDetector;
pub use yara_matcher::YaraMatcher;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[wasm_bindgen]
pub struct ScanError {
    pub error_code: String,
    pub error_message: String,
    pub suggestion: String,
}

#[wasm_bindgen]
impl ScanError {
    #[wasm_bindgen(constructor)]
    pub fn new(error_code: String, error_message: String, suggestion: String) -> Self {
        ScanError {
            error_code,
            error_message,
            suggestion,
        }
    }

    pub fn encrypted() -> Self {
        ScanError {
            error_code: "ENCRYPTED_PDF".to_string(),
            error_message: "PDF文件已加密，需要密码才能解析".to_string(),
            suggestion: "请上传解密后的PDF文件，或提供正确的密码后重新扫描".to_string(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn error_code(&self) -> String {
        self.error_code.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn error_message(&self) -> String {
        self.error_message.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn suggestion(&self) -> String {
        self.suggestion.clone()
    }

    pub fn to_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(self).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[wasm_bindgen]
pub struct ScanResult {
    pub risk_level: String,
    pub risk_score: u32,
    pub malicious_code_snippets: Vec<MaliciousCode>,
    pub extracted_scripts: Vec<ExtractedScript>,
    pub yara_matches: Vec<YaraMatch>,
    pub summary: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[wasm_bindgen]
pub struct MaliciousCode {
    pub code_type: String,
    pub content: String,
    pub description: String,
    pub severity: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[wasm_bindgen]
pub struct ExtractedScript {
    pub script_type: String,
    pub content: String,
    pub location: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[wasm_bindgen]
pub struct YaraMatch {
    pub rule_name: String,
    pub description: String,
    pub matched_strings: Vec<String>,
    pub severity: String,
}

#[wasm_bindgen]
impl ScanResult {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        ScanResult {
            risk_level: "Safe".to_string(),
            risk_score: 0,
            malicious_code_snippets: Vec::new(),
            extracted_scripts: Vec::new(),
            yara_matches: Vec::new(),
            summary: String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn risk_level(&self) -> String {
        self.risk_level.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn risk_score(&self) -> u32 {
        self.risk_score
    }

    #[wasm_bindgen(getter)]
    pub fn summary(&self) -> String {
        self.summary.clone()
    }

    pub fn to_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(self).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

#[wasm_bindgen]
pub struct PdfSecurityScanner {
    pdf_parser: PdfParser,
    malware_detector: MalwareDetector,
    yara_matcher: YaraMatcher,
}

#[wasm_bindgen]
impl PdfSecurityScanner {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<PdfSecurityScanner, JsValue> {
        Ok(PdfSecurityScanner {
            pdf_parser: PdfParser::new(),
            malware_detector: MalwareDetector::new(),
            yara_matcher: YaraMatcher::new()?,
        })
    }

    pub fn scan_pdf(&mut self, pdf_data: &[u8]) -> Result<ScanResult, JsValue> {
        let mut result = ScanResult::new();

        let scripts = match self.pdf_parser.extract_scripts(pdf_data) {
            Ok(s) => s,
            Err(e) => {
                let err_str = e.to_string();
                if err_str.starts_with("ENCRYPTED_PDF") {
                    let scan_error = ScanError::encrypted();
                    return Err(JsValue::from_str(&serde_json::to_string(&scan_error)
                        .unwrap_or_else(|_| "{\"error_code\":\"ENCRYPTED_PDF\"}".to_string())));
                }
                return Err(JsValue::from_str(&err_str));
            }
        };
        
        result.extracted_scripts = scripts.clone();

        let detections = self.malware_detector.analyze_scripts(&scripts);
        result.malicious_code_snippets = detections.snippets;
        result.risk_score = detections.risk_score;

        let yara_results = self.yara_matcher.scan_scripts(&scripts)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        result.yara_matches = yara_results.matches;
        result.risk_score += yara_results.additional_score;

        result.risk_level = self.calculate_risk_level(result.risk_score);
        result.summary = self.generate_summary(&result);

        Ok(result)
    }

    fn calculate_risk_level(&self, score: u32) -> String {
        match score {
            0..=20 => "Safe".to_string(),
            21..=50 => "Low".to_string(),
            51..=80 => "Medium".to_string(),
            81..=100 => "High".to_string(),
            _ => "Critical".to_string(),
        }
    }

    fn generate_summary(&self, result: &ScanResult) -> String {
        let script_count = result.extracted_scripts.len();
        let detection_count = result.malicious_code_snippets.len();
        let yara_count = result.yara_matches.len();

        format!(
            "PDF扫描完成: 检测到 {} 个脚本, {} 个恶意模式, {} 个YARA规则匹配. 风险等级: {}, 风险分数: {}",
            script_count, detection_count, yara_count, result.risk_level, result.risk_score
        )
    }

    pub fn add_yara_rule(&mut self, rule_name: &str, rule_content: &str) -> Result<(), JsValue> {
        self.yara_matcher.add_rule(rule_name, rule_content)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}
