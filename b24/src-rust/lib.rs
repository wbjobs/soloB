use wasm_bindgen::prelude::*;
use std::cmp::min;

const MAX_SEQUENCE_LENGTH: usize = 2000;

#[wasm_bindgen]
pub struct AlignmentResult {
    score: i32,
    aligned_seq1: String,
    aligned_seq2: String,
}

#[wasm_bindgen]
impl AlignmentResult {
    #[wasm_bindgen(getter)]
    pub fn score(&self) -> i32 {
        self.score
    }

    #[wasm_bindgen(getter)]
    pub fn aligned_seq1(&self) -> String {
        self.aligned_seq1.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn aligned_seq2(&self) -> String {
        self.aligned_seq2.clone()
    }
}

#[wasm_bindgen]
pub fn get_max_sequence_length() -> usize {
    MAX_SEQUENCE_LENGTH
}

fn smith_waterman_standard(
    seq1: &[u8],
    seq2: &[u8],
    match_score: i32,
    mismatch_score: i32,
    gap_penalty: i32,
) -> AlignmentResult {
    let m = seq1.len();
    let n = seq2.len();
    
    let cols = n + 1;
    let total_size = (m + 1) * cols;
    
    let mut score_matrix: Vec<i32> = vec![0; total_size];
    let mut traceback: Vec<u8> = vec![0; total_size];

    let mut max_score = 0;
    let mut max_i = 0;
    let mut max_j = 0;

    for i in 1..=m {
        let row_start = i * cols;
        let prev_row_start = (i - 1) * cols;
        
        for j in 1..=n {
            let idx = row_start + j;
            let diag_idx = prev_row_start + (j - 1);
            let up_idx = prev_row_start + j;
            let left_idx = row_start + (j - 1);
            
            let score_diag = score_matrix[diag_idx]
                + if seq1[i - 1] == seq2[j - 1] {
                    match_score
                } else {
                    mismatch_score
                };
            
            let score_up = score_matrix[up_idx] + gap_penalty;
            let score_left = score_matrix[left_idx] + gap_penalty;

            let current_score = 0i32.max(score_diag).max(score_up).max(score_left);

            score_matrix[idx] = current_score;

            if current_score == score_diag {
                traceback[idx] = 1;
            } else if current_score == score_up {
                traceback[idx] = 2;
            } else if current_score == score_left {
                traceback[idx] = 3;
            } else {
                traceback[idx] = 0;
            }

            if current_score > max_score {
                max_score = current_score;
                max_i = i;
                max_j = j;
            }
        }
    }

    let mut aligned1 = Vec::new();
    let mut aligned2 = Vec::new();
    let mut i = max_i;
    let mut j = max_j;

    while i > 0 && j > 0 {
        let idx = i * cols + j;
        if score_matrix[idx] == 0 {
            break;
        }
        
        match traceback[idx] {
            1 => {
                aligned1.push(seq1[i - 1]);
                aligned2.push(seq2[j - 1]);
                i -= 1;
                j -= 1;
            }
            2 => {
                aligned1.push(seq1[i - 1]);
                aligned2.push(b'-');
                i -= 1;
            }
            3 => {
                aligned1.push(b'-');
                aligned2.push(seq2[j - 1]);
                j -= 1;
            }
            _ => break,
        }
    }

    aligned1.reverse();
    aligned2.reverse();

    AlignmentResult {
        score: max_score,
        aligned_seq1: String::from_utf8_lossy(&aligned1).into_owned(),
        aligned_seq2: String::from_utf8_lossy(&aligned2).into_owned(),
    }
}

fn smith_waterman_optimized(
    seq1: &[u8],
    seq2: &[u8],
    match_score: i32,
    mismatch_score: i32,
    gap_penalty: i32,
) -> AlignmentResult {
    let m = seq1.len();
    let n = seq2.len();
    
    let mut prev_row: Vec<i32> = vec![0; n + 1];
    let mut curr_row: Vec<i32> = vec![0; n + 1];
    
    let mut max_score = 0;
    let mut max_i = 0;
    let mut max_j = 0;
    
    let mut max_row = 0;
    let mut max_col = 0;
    
    for i in 1..=m {
        curr_row[0] = 0;
        let mut diag = prev_row[0];
        
        for j in 1..=n {
            let old_val = prev_row[j];
            
            let score_diag = diag
                + if seq1[i - 1] == seq2[j - 1] {
                    match_score
                } else {
                    mismatch_score
                };
            
            let score_up = prev_row[j] + gap_penalty;
            let score_left = curr_row[j - 1] + gap_penalty;
            
            let current_score = 0i32.max(score_diag).max(score_up).max(score_left);
            curr_row[j] = current_score;
            diag = old_val;
            
            if current_score > max_score {
                max_score = current_score;
                max_i = i;
                max_j = j;
                max_row = i;
                max_col = j;
            }
        }
        
        std::mem::swap(&mut prev_row, &mut curr_row);
    }
    
    let aligned_len = min(max_row, max_col);
    let mut aligned1: Vec<u8> = Vec::with_capacity(aligned_len + 10);
    let mut aligned2: Vec<u8> = Vec::with_capacity(aligned_len + 10);
    
    let mut i = max_row;
    let mut j = max_col;
    
    let mut final_score = 0;
    
    while i > 0 && j > 0 {
        if seq1[i - 1] == seq2[j - 1] {
            aligned1.push(seq1[i - 1]);
            aligned2.push(seq2[j - 1]);
            final_score += match_score;
            i -= 1;
            j -= 1;
        } else {
            let try_gap1 = if i > 0 {
                let mut temp_i = i - 1;
                let mut temp_j = j;
                let mut count = 0;
                while temp_i > 0 && temp_j > 0 && count < 5 {
                    if seq1[temp_i - 1] == seq2[temp_j - 1] {
                        break;
                    }
                    temp_i -= 1;
                    count += 1;
                }
                if temp_i > 0 && temp_j > 0 && seq1[temp_i - 1] == seq2[temp_j - 1] {
                    Some(count)
                } else {
                    None
                }
            } else {
                None
            };
            
            let try_gap2 = if j > 0 {
                let mut temp_i = i;
                let mut temp_j = j - 1;
                let mut count = 0;
                while temp_i > 0 && temp_j > 0 && count < 5 {
                    if seq1[temp_i - 1] == seq2[temp_j - 1] {
                        break;
                    }
                    temp_j -= 1;
                    count += 1;
                }
                if temp_i > 0 && temp_j > 0 && seq1[temp_i - 1] == seq2[temp_j - 1] {
                    Some(count)
                } else {
                    None
                }
            } else {
                None
            };
            
            match (try_gap1, try_gap2) {
                (Some(g1), Some(g2)) => {
                    if g1 <= g2 {
                        for _ in 0..g1 {
                            aligned1.push(seq1[i - 1]);
                            aligned2.push(b'-');
                            final_score += gap_penalty;
                            i -= 1;
                        }
                    } else {
                        for _ in 0..g2 {
                            aligned1.push(b'-');
                            aligned2.push(seq2[j - 1]);
                            final_score += gap_penalty;
                            j -= 1;
                        }
                    }
                }
                (Some(g1), None) => {
                    for _ in 0..g1 {
                        aligned1.push(seq1[i - 1]);
                        aligned2.push(b'-');
                        final_score += gap_penalty;
                        i -= 1;
                    }
                }
                (None, Some(g2)) => {
                    for _ in 0..g2 {
                        aligned1.push(b'-');
                        aligned2.push(seq2[j - 1]);
                        final_score += gap_penalty;
                        j -= 1;
                    }
                }
                (None, None) => {
                    aligned1.push(seq1[i - 1]);
                    aligned2.push(seq2[j - 1]);
                    final_score += mismatch_score;
                    i -= 1;
                    j -= 1;
                }
            }
            
            if final_score < 0 {
                break;
            }
        }
    }
    
    aligned1.reverse();
    aligned2.reverse();
    
    AlignmentResult {
        score: max_score,
        aligned_seq1: String::from_utf8_lossy(&aligned1).into_owned(),
        aligned_seq2: String::from_utf8_lossy(&aligned2).into_owned(),
    }
}

#[wasm_bindgen]
pub fn smith_waterman(
    seq1: &str,
    seq2: &str,
    match_score: i32,
    mismatch_score: i32,
    gap_penalty: i32,
) -> Result<AlignmentResult, JsValue> {
    let seq1_bytes = seq1.as_bytes();
    let seq2_bytes = seq2.as_bytes();
    
    if seq1_bytes.len() > MAX_SEQUENCE_LENGTH || seq2_bytes.len() > MAX_SEQUENCE_LENGTH {
        return Err(JsValue::from_str(&format!(
            "Sequence too long. Maximum allowed length is {} characters.",
            MAX_SEQUENCE_LENGTH
        )));
    }
    
    let m = seq1_bytes.len();
    let n = seq2_bytes.len();
    
    let required_memory = (m + 1) * (n + 1) * 5;
    
    if m <= 2000 && n <= 2000 && required_memory < 20_000_000 {
        Ok(smith_waterman_standard(seq1_bytes, seq2_bytes, match_score, mismatch_score, gap_penalty))
    } else {
        Ok(smith_waterman_optimized(seq1_bytes, seq2_bytes, match_score, mismatch_score, gap_penalty))
    }
}
