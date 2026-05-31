use wasm_bindgen::prelude::*;

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

fn create_score_matrix(rows: usize, cols: usize) -> Vec<Vec<i32>> {
    vec![vec![0; cols]; rows]
}

fn create_traceback_matrix(rows: usize, cols: usize) -> Vec<Vec<u8>> {
    vec![vec![0; cols]; rows]
}

#[wasm_bindgen]
pub fn smith_waterman(
    seq1: &str,
    seq2: &str,
    match_score: i32,
    mismatch_score: i32,
    gap_penalty: i32,
) -> AlignmentResult {
    let seq1_chars: Vec<char> = seq1.chars().collect();
    let seq2_chars: Vec<char> = seq2.chars().collect();

    let m = seq1_chars.len();
    let n = seq2_chars.len();

    let mut score_matrix = create_score_matrix(m + 1, n + 1);
    let mut traceback = create_traceback_matrix(m + 1, n + 1);

    let mut max_score = 0;
    let mut max_i = 0;
    let mut max_j = 0;

    for i in 1..=m {
        for j in 1..=n {
            let score_diag = score_matrix[i - 1][j - 1]
                + if seq1_chars[i - 1] == seq2_chars[j - 1] {
                    match_score
                } else {
                    mismatch_score
                };
            let score_up = score_matrix[i - 1][j] + gap_penalty;
            let score_left = score_matrix[i][j - 1] + gap_penalty;

            let current_score = *[0, score_diag, score_up, score_left].iter().max().unwrap();

            score_matrix[i][j] = current_score;

            if current_score == score_diag {
                traceback[i][j] = 1;
            } else if current_score == score_up {
                traceback[i][j] = 2;
            } else if current_score == score_left {
                traceback[i][j] = 3;
            } else {
                traceback[i][j] = 0;
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

    while i > 0 && j > 0 && score_matrix[i][j] > 0 {
        match traceback[i][j] {
            1 => {
                aligned1.push(seq1_chars[i - 1]);
                aligned2.push(seq2_chars[j - 1]);
                i -= 1;
                j -= 1;
            }
            2 => {
                aligned1.push(seq1_chars[i - 1]);
                aligned2.push('-');
                i -= 1;
            }
            3 => {
                aligned1.push('-');
                aligned2.push(seq2_chars[j - 1]);
                j -= 1;
            }
            _ => break,
        }
    }

    aligned1.reverse();
    aligned2.reverse();

    AlignmentResult {
        score: max_score,
        aligned_seq1: aligned1.into_iter().collect(),
        aligned_seq2: aligned2.into_iter().collect(),
    }
}
