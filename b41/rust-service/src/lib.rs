#[cfg(feature = "server")]
pub mod alignment {
    tonic::include_proto!("alignment");
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressUpdate {
    pub step: i32,
    pub total: i32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlignmentResult {
    pub aligned_a: String,
    pub aligned_b: String,
    pub alignment_string: String,
    pub score: i32,
    pub progress: Vec<ProgressUpdate>,
}

pub struct NeedlemanWunsch {
    match_score: i32,
    mismatch_score: i32,
    gap_score: i32,
}

impl NeedlemanWunsch {
    pub fn new(match_score: i32, mismatch_score: i32, gap_score: i32) -> Self {
        NeedlemanWunsch {
            match_score,
            mismatch_score,
            gap_score,
        }
    }

    pub fn align(&self, seq_a: &str, seq_b: &str) -> AlignmentResult {
        let mut progress = Vec::new();
        progress.push(ProgressUpdate {
            step: 1,
            total: 4,
            message: "初始化矩阵".to_string(),
        });

        let m = seq_a.len();
        let n = seq_b.len();
        let mut dp = vec![vec![0i32; n + 1]; m + 1];

        for i in 0..=m {
            dp[i][0] = self.gap_score * i as i32;
        }
        for j in 0..=n {
            dp[0][j] = self.gap_score * j as i32;
        }

        progress.push(ProgressUpdate {
            step: 2,
            total: 4,
            message: "填充矩阵".to_string(),
        });

        let seq_a_chars: Vec<char> = seq_a.chars().collect();
        let seq_b_chars: Vec<char> = seq_b.chars().collect();

        for i in 1..=m {
            for j in 1..=n {
                let match_ = if seq_a_chars[i - 1] == seq_b_chars[j - 1] {
                    self.match_score
                } else {
                    self.mismatch_score
                };
                dp[i][j] = (dp[i - 1][j - 1] + match_)
                    .max(dp[i - 1][j] + self.gap_score)
                    .max(dp[i][j - 1] + self.gap_score);
            }
        }

        progress.push(ProgressUpdate {
            step: 3,
            total: 4,
            message: "回溯比对".to_string(),
        });

        let mut i = m;
        let mut j = n;
        let mut aligned_a = String::new();
        let mut aligned_b = String::new();
        let mut alignment_string = String::new();

        while i > 0 && j > 0 {
            let current = dp[i][j];
            let diagonal = dp[i - 1][j - 1];
            let up = dp[i - 1][j];
            let left = dp[i][j - 1];

            let char_a = seq_a_chars[i - 1];
            let char_b = seq_b_chars[j - 1];

            let match_score_val = if char_a == char_b {
                self.match_score
            } else {
                self.mismatch_score
            };

            if current == diagonal + match_score_val {
                aligned_a.push(char_a);
                aligned_b.push(char_b);
                if char_a == char_b {
                    alignment_string.push('|');
                } else {
                    alignment_string.push('*');
                }
                i -= 1;
                j -= 1;
            } else if current == up + self.gap_score {
                aligned_a.push(char_a);
                aligned_b.push('-');
                alignment_string.push(' ');
                i -= 1;
            } else {
                aligned_a.push('-');
                aligned_b.push(char_b);
                alignment_string.push(' ');
                j -= 1;
            }
        }

        while i > 0 {
            aligned_a.push(seq_a_chars[i - 1]);
            aligned_b.push('-');
            alignment_string.push(' ');
            i -= 1;
        }

        while j > 0 {
            aligned_a.push('-');
            aligned_b.push(seq_b_chars[j - 1]);
            alignment_string.push(' ');
            j -= 1;
        }

        aligned_a = aligned_a.chars().rev().collect();
        aligned_b = aligned_b.chars().rev().collect();
        alignment_string = alignment_string.chars().rev().collect();

        progress.push(ProgressUpdate {
            step: 4,
            total: 4,
            message: "完成比对".to_string(),
        });

        AlignmentResult {
            aligned_a,
            aligned_b,
            alignment_string,
            score: dp[m][n],
            progress,
        }
    }
}

pub fn parse_fasta(content: &str) -> String {
    content
        .lines()
        .filter(|line| !line.starts_with('>'))
        .map(|line| line.trim())
        .collect::<String>()
        .to_uppercase()
}

#[cfg(feature = "server")]
pub mod server {
    use super::*;
    use alignment::{AlignRequest, AlignResponse, AlignmentService};
    use tonic::{Request, Response, Status};

    #[derive(Default)]
    pub struct AlignmentServiceImpl;

    #[tonic::async_trait]
    impl AlignmentService for AlignmentServiceImpl {
        async fn align(
            &self,
            request: Request<AlignRequest>,
        ) -> Result<Response<AlignResponse>, Status> {
            let req = request.into_inner();
            
            let nw = NeedlemanWunsch::new(
                req.match_score,
                req.mismatch_score,
                req.gap_score,
            );

            let result = nw.align(&req.sequence_a, &req.sequence_b);

            Ok(Response::new(AlignResponse {
                aligned_a: result.aligned_a,
                aligned_b: result.aligned_b,
                alignment_string: result.alignment_string,
                score: result.score,
                progress: result.progress.iter().map(|p| alignment::ProgressUpdate {
                    step: p.step,
                    total: p.total,
                    message: p.message.clone(),
                }).collect(),
            }))
        }
    }
}

use std::alloc::{alloc, dealloc, Layout};
use std::ptr;

#[no_mangle]
pub extern "C" fn malloc(size: usize) -> *mut u8 {
    if size == 0 {
        return ptr::null_mut();
    }
    let layout = Layout::from_size_align(size, 1).unwrap();
    unsafe { alloc(layout) }
}

#[no_mangle]
pub extern "C" fn free(ptr: *mut u8, size: usize) {
    if ptr.is_null() {
        return;
    }
    let layout = Layout::from_size_align(size, 1).unwrap();
    unsafe { dealloc(ptr, layout) };
}

#[derive(Debug, Serialize, Deserialize)]
struct WasmInput {
    seq_a: String,
    seq_b: String,
    match_score: i32,
    mismatch_score: i32,
    gap_score: i32,
}

#[no_mangle]
pub extern "C" fn align_sequences_json(
    input_ptr: *const u8,
    input_len: usize,
    output_len_ptr: *mut usize,
) -> *mut u8 {
    if input_ptr.is_null() {
        let empty = serde_json::to_string(&AlignmentResult {
            aligned_a: String::new(),
            aligned_b: String::new(),
            alignment_string: String::new(),
            score: 0,
            progress: vec![],
        }).unwrap();
        let bytes = empty.into_bytes();
        unsafe {
            if !output_len_ptr.is_null() {
                *output_len_ptr = bytes.len();
            }
        }
        let ptr = malloc(bytes.len());
        if !ptr.is_null() {
            unsafe {
                ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
            }
        }
        return ptr;
    }

    let input_slice = unsafe { std::slice::from_raw_parts(input_ptr, input_len) };
    let input_str = match std::str::from_utf8(input_slice) {
        Ok(s) => s,
        Err(_) => {
            let error = serde_json::to_string(&AlignmentResult {
                aligned_a: String::new(),
                aligned_b: String::new(),
                alignment_string: String::new(),
                score: 0,
                progress: vec![ProgressUpdate { step: 0, total: 4, message: "UTF-8解码失败".to_string() }],
            }).unwrap();
            let bytes = error.into_bytes();
            unsafe {
                if !output_len_ptr.is_null() {
                    *output_len_ptr = bytes.len();
                }
            }
            let ptr = malloc(bytes.len());
            if !ptr.is_null() {
                unsafe {
                    ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
                }
            }
            return ptr;
        }
    };

    let input: WasmInput = match serde_json::from_str(input_str) {
        Ok(i) => i,
        Err(e) => {
            let error = serde_json::to_string(&AlignmentResult {
                aligned_a: String::new(),
                aligned_b: String::new(),
                alignment_string: String::new(),
                score: 0,
                progress: vec![ProgressUpdate { step: 0, total: 4, message: format!("JSON解析失败: {}", e) }],
            }).unwrap();
            let bytes = error.into_bytes();
            unsafe {
                if !output_len_ptr.is_null() {
                    *output_len_ptr = bytes.len();
                }
            }
            let ptr = malloc(bytes.len());
            if !ptr.is_null() {
                unsafe {
                    ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
                }
            }
            return ptr;
        }
    };

    let nw = NeedlemanWunsch::new(
        input.match_score,
        input.mismatch_score,
        input.gap_score,
    );

    let result = nw.align(&input.seq_a, &input.seq_b);
    let output_json = match serde_json::to_string(&result) {
        Ok(json) => json,
        Err(e) => {
            let error = serde_json::to_string(&AlignmentResult {
                aligned_a: String::new(),
                aligned_b: String::new(),
                alignment_string: String::new(),
                score: 0,
                progress: vec![ProgressUpdate { step: 0, total: 4, message: format!("序列化失败: {}", e) }],
            }).unwrap();
            error
        }
    };

    let bytes = output_json.into_bytes();
    unsafe {
        if !output_len_ptr.is_null() {
            *output_len_ptr = bytes.len();
        }
    }

    let ptr = malloc(bytes.len());
    if !ptr.is_null() {
        unsafe {
            ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        }
    }

    ptr
}
