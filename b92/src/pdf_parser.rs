use lopdf::{Document, Object, ObjectId};
use std::collections::HashMap;
use thiserror::Error;
use super::ExtractedScript;

#[derive(Error, Debug)]
pub enum PdfParserError {
    #[error("PDF parsing error: {0}")]
    ParseError(#[from] lopdf::Error),
    
    #[error("UTF-8 decoding error: {0}")]
    Utf8Error(#[from] std::string::FromUtf8Error),
    
    #[error("No scripts found")]
    NoScriptsFound,
    
    #[error("ENCRYPTED_PDF: PDF文件已加密，需要密码才能解析")]
    EncryptedPdf,
    
    #[error("PDF parsing failed: {0}")]
    OtherError(String),
}

pub struct PdfParser;

impl PdfParser {
    pub fn new() -> Self {
        PdfParser
    }

    fn is_encrypted_pdf(&self, pdf_data: &[u8]) -> bool {
        if pdf_data.len() < 10 {
            return false;
        }
        
        let data_str = String::from_utf8_lossy(pdf_data);
        
        if data_str.contains("/Encrypt") {
            return true;
        }
        
        if data_str.contains("/EncryptName") || data_str.contains("/Filter") && data_str.contains("/Standard") {
            return true;
        }
        
        false
    }

    fn check_document_encryption(&self, doc: &Document) -> bool {
        if doc.trailer.get(b"Encrypt").is_some() {
            return true;
        }
        
        if let Ok(catalog) = doc.catalog() {
            if catalog.get(b"Encrypt").is_some() {
                return true;
            }
        }
        
        false
    }

    pub fn extract_scripts(&self, pdf_data: &[u8]) -> Result<Vec<ExtractedScript>, PdfParserError> {
        if self.is_encrypted_pdf(pdf_data) {
            return Err(PdfParserError::EncryptedPdf);
        }

        let doc = match Document::load_mem(pdf_data) {
            Ok(d) => d,
            Err(e) => {
                if let lopdf::Error::Encryption = e {
                    return Err(PdfParserError::EncryptedPdf);
                }
                let err_str = e.to_string();
                if err_str.contains("encrypt") || err_str.contains("Encrypt") || err_str.contains("password") {
                    return Err(PdfParserError::EncryptedPdf);
                }
                return Err(PdfParserError::ParseError(e));
            }
        };

        if self.check_document_encryption(&doc) {
            return Err(PdfParserError::EncryptedPdf);
        }

        let mut scripts = Vec::new();

        self.extract_javascript(&doc, &mut scripts)?;
        self.extract_actions(&doc, &mut scripts)?;
        self.extract_open_actions(&doc, &mut scripts)?;
        self.extract_embedded_files(&doc, &mut scripts)?;

        Ok(scripts)
    }

    fn extract_javascript(&self, doc: &Document, scripts: &mut Vec<ExtractedScript>) -> Result<(), PdfParserError> {
        for (object_id, object) in doc.objects.iter() {
            if let Object::Dictionary(dict) = object {
                if let Some(js_obj) = dict.get(b"JS") {
                    if let Ok(js_content) = self.extract_string_from_object(doc, js_obj) {
                        if !js_content.is_empty() {
                            scripts.push(ExtractedScript {
                                script_type: "JavaScript".to_string(),
                                content: js_content,
                                location: format!("Object {:?}", object_id),
                            });
                        }
                    }
                }

                if let Some(aa_obj) = dict.get(b"AA") {
                    if let Object::Dictionary(aa_dict) = aa_obj {
                        for (key, value) in aa_dict.iter() {
                            if let Ok(action_content) = self.extract_action_script(doc, value) {
                                if !action_content.is_empty() {
                                    scripts.push(ExtractedScript {
                                        script_type: format!("AdditionalAction-{}", String::from_utf8_lossy(key)),
                                        content: action_content,
                                        location: format!("Object {:?}", object_id),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn extract_actions(&self, doc: &Document, scripts: &mut Vec<ExtractedScript>) -> Result<(), PdfParserError> {
        for (object_id, object) in doc.objects.iter() {
            if let Object::Dictionary(dict) = object {
                if let Some(action_type) = dict.get(b"S") {
                    if let Object::Name(action_name) = action_type {
                        let action_str = String::from_utf8_lossy(action_name).to_string();
                        
                        if action_str == "JavaScript" {
                            if let Some(js_obj) = dict.get(b"JS") {
                                if let Ok(js_content) = self.extract_string_from_object(doc, js_obj) {
                                    if !js_content.is_empty() {
                                        scripts.push(ExtractedScript {
                                            script_type: "JavaScriptAction".to_string(),
                                            content: js_content,
                                            location: format!("Object {:?}", object_id),
                                        });
                                    }
                                }
                            }
                        } else if action_str == "Launch" || action_str == "Open" {
                            scripts.push(ExtractedScript {
                                script_type: format!("{}Action", action_str),
                                content: format!("Action type: {}", action_str),
                                location: format!("Object {:?}", object_id),
                            });
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn extract_open_actions(&self, doc: &Document, scripts: &mut Vec<ExtractedScript>) -> Result<(), PdfParserError> {
        if let Some(catalog) = doc.trailer.get(b"Root") {
            if let Ok(catalog_obj) = doc.deref_object(catalog.clone()) {
                if let Object::Dictionary(catalog_dict) = catalog_obj {
                    if let Some(open_action) = catalog_dict.get(b"OpenAction") {
                        if let Ok(action_content) = self.extract_action_script(doc, open_action) {
                            if !action_content.is_empty() {
                                scripts.push(ExtractedScript {
                                    script_type: "OpenAction".to_string(),
                                    content: action_content,
                                    location: "Catalog OpenAction".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn extract_embedded_files(&self, doc: &Document, scripts: &mut Vec<ExtractedScript>) -> Result<(), PdfParserError> {
        for (object_id, object) in doc.objects.iter() {
            if let Object::Dictionary(dict) = object {
                if let Some(ef_dict) = dict.get(b"EF") {
                    if let Object::Dictionary(ef) = ef_dict {
                        for (key, value) in ef.iter() {
                            let filename = String::from_utf8_lossy(key).to_string();
                            if filename.ends_with(".js") || filename.ends_with(".vbs") || 
                               filename.ends_with(".bat") || filename.ends_with(".exe") {
                                scripts.push(ExtractedScript {
                                    script_type: "EmbeddedFile".to_string(),
                                    content: format!("Embedded suspicious file: {}", filename),
                                    location: format!("Object {:?}", object_id),
                                });
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn extract_action_script(&self, doc: &Document, action_obj: &Object) -> Result<String, PdfParserError> {
        match action_obj {
            Object::Dictionary(dict) => {
                if let Some(js_obj) = dict.get(b"JS") {
                    return self.extract_string_from_object(doc, js_obj);
                }
                if let Some(s_obj) = dict.get(b"S") {
                    if let Object::Name(name) = s_obj {
                        return Ok(format!("Action type: {}", String::from_utf8_lossy(name)));
                    }
                }
                Ok(String::new())
            }
            Object::Array(arr) => {
                let mut results = Vec::new();
                for obj in arr {
                    if let Ok(content) = self.extract_action_script(doc, obj) {
                        if !content.is_empty() {
                            results.push(content);
                        }
                    }
                }
                Ok(results.join("\n"))
            }
            _ => Ok(String::new()),
        }
    }

    fn extract_string_from_object(&self, doc: &Document, obj: &Object) -> Result<String, PdfParserError> {
        match obj {
            Object::String(bytes, _) => Ok(String::from_utf8(bytes.clone())?),
            Object::Stream(stream) => {
                let decoded_content = stream.decompressed_content()?;
                Ok(String::from_utf8(decoded_content)?)
            }
            Object::Reference(id) => {
                let dereferenced = doc.deref_object(Object::Reference(*id))?;
                self.extract_string_from_object(doc, &dereferenced)
            }
            _ => Ok(String::new()),
        }
    }
}

impl Default for PdfParser {
    fn default() -> Self {
        Self::new()
    }
}
