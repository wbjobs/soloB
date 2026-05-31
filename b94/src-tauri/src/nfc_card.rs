use rand::Rng;
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct NfcCard {
    pub uid: String,
    pub uid_type: String,
    pub sak: u8,
    pub atqa: [u8; 2],
}

#[tauri::command]
pub fn generate_uid() -> NfcCard {
    let mut rng = rand::thread_rng();
    
    let uid_type = if rng.gen_bool(0.5) {
        "single"
    } else {
        "double"
    };

    let uid_bytes = if uid_type == "single" {
        let mut bytes = [0u8; 4];
        rng.fill(&mut bytes);
        bytes[0] &= 0x0F;
        bytes.to_vec()
    } else {
        let mut bytes = [0u8; 7];
        rng.fill(&mut bytes);
        bytes[0] = 0x88;
        bytes.to_vec()
    };

    let uid = hex::encode_upper(&uid_bytes);
    
    let sak: u8 = rng.gen_range(0x08..=0x18);
    
    let atqa = [rng.gen_range(0x00..=0xFF), rng.gen_range(0x00..=0x04)];

    NfcCard {
        uid,
        uid_type: uid_type.to_string(),
        sak,
        atqa,
    }
}
