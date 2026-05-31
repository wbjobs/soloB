use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Serialize, Deserialize)]
struct EncryptedData {
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Serialize)]
struct KeyResult {
    key: String,
}

#[derive(Debug, Serialize)]
struct ErrorResult {
    error: String,
}

fn generate_key() -> String {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    general_purpose::STANDARD.encode(&key)
}

fn decode_key(key_str: &str) -> Result<[u8; 32], String> {
    let key_bytes = general_purpose::STANDARD
        .decode(key_str)
        .map_err(|_| "Invalid key format".to_string())?;
    
    if key_bytes.len() != 32 {
        return Err("Invalid key length".to_string());
    }
    
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_bytes);
    Ok(key)
}

fn encrypt(plaintext: &str, key_str: &str) -> Result<EncryptedData, String> {
    let key = decode_key(key_str)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "Invalid key".to_string())?;
    
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| "Encryption failed".to_string())?;
    
    Ok(EncryptedData {
        nonce: general_purpose::STANDARD.encode(&nonce_bytes),
        ciphertext: general_purpose::STANDARD.encode(&ciphertext),
    })
}

fn decrypt(encrypted: &EncryptedData, key_str: &str) -> Result<String, String> {
    let key = decode_key(key_str)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "Invalid key".to_string())?;
    
    let nonce_bytes = general_purpose::STANDARD
        .decode(&encrypted.nonce)
        .map_err(|_| "Invalid nonce".to_string())?;
    
    if nonce_bytes.len() != 12 {
        return Err("Invalid nonce length".to_string());
    }
    
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = general_purpose::STANDARD
        .decode(&encrypted.ciphertext)
        .map_err(|_| "Invalid ciphertext".to_string())?;
    
    let plaintext_bytes = cipher
        .decrypt(nonce, &ciphertext)
        .map_err(|_| "Decryption failed - wrong key or corrupted data".to_string())?;
    
    String::from_utf8(plaintext_bytes)
        .map_err(|_| "Invalid UTF-8 in decrypted data".to_string())
}

fn print_error(message: &str) {
    let error = ErrorResult {
        error: message.to_string(),
    };
    println!("{}", serde_json::to_string(&error).unwrap());
    std::process::exit(1);
}

fn main() {
    let args: Vec<String> = env::args().collect();
    
    if args.len() < 2 {
        print_error("Usage: secure-notes-core <command> [args]");
        return;
    }
    
    let command = &args[1];
    
    match command.as_str() {
        "generate-key" => {
            let key = generate_key();
            let result = KeyResult { key };
            println!("{}", serde_json::to_string(&result).unwrap());
        }
        
        "encrypt" => {
            if args.len() < 4 {
                print_error("Usage: secure-notes-core encrypt <plaintext> <key>");
                return;
            }
            
            let plaintext = &args[2];
            let key_str = &args[3];
            
            match encrypt(plaintext, key_str) {
                Ok(encrypted) => {
                    println!("{}", serde_json::to_string(&encrypted).unwrap());
                }
                Err(e) => print_error(&e),
            }
        }
        
        "decrypt" => {
            if args.len() < 4 {
                print_error("Usage: secure-notes-core decrypt <encrypted_json> <key>");
                return;
            }
            
            let encrypted_json = &args[2];
            let key_str = &args[3];
            
            let encrypted: EncryptedData = match serde_json::from_str(encrypted_json) {
                Ok(e) => e,
                Err(_) => {
                    print_error("Invalid encrypted data JSON");
                    return;
                }
            };
            
            match decrypt(&encrypted, key_str) {
                Ok(plaintext) => {
                    println!("{}", plaintext);
                }
                Err(e) => print_error(&e),
            }
        }
        
        _ => {
            print_error(&format!("Unknown command: {}", command));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let key = generate_key();
        let plaintext = "Hello, World! 这是一个测试笔记 🔐";
        
        let encrypted = encrypt(plaintext, &key).unwrap();
        assert_ne!(encrypted.ciphertext, plaintext);
        
        let decrypted = decrypt(&encrypted, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key() {
        let key1 = generate_key();
        let key2 = generate_key();
        let plaintext = "Test message";
        
        let encrypted = encrypt(plaintext, &key1).unwrap();
        let result = decrypt(&encrypted, &key2);
        assert!(result.is_err());
    }

    #[test]
    fn test_generate_key_length() {
        let key = generate_key();
        let key_bytes = general_purpose::STANDARD.decode(&key).unwrap();
        assert_eq!(key_bytes.len(), 32);
    }
}
