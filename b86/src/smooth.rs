use ndarray::{Array1, Axis};

fn savgol_coefficients(window_size: usize, poly_order: usize) -> Vec<f64> {
    assert!(window_size % 2 == 1, "Window size must be odd");
    assert!(poly_order < window_size, "Polynomial order must be less than window size");

    let half = (window_size - 1) / 2;
    let mut j_matrix = vec![vec![0.0; poly_order + 1]; window_size];

    for i in 0..window_size {
        let x = (i as isize - half as isize) as f64;
        for j in 0..=poly_order {
            j_matrix[i][j] = x.powi(j as i32);
        }
    }

    let j_t = transpose(&j_matrix);
    let jt_j = multiply_matrices(&j_t, &j_matrix);
    let jt_j_inv = matrix_inverse(&jt_j).unwrap();
    let coeff_matrix = multiply_matrices(&jt_j_inv, &j_t);

    coeff_matrix[0].clone()
}

fn transpose(matrix: &[Vec<f64>]) -> Vec<Vec<f64>> {
    let rows = matrix.len();
    let cols = matrix[0].len();
    let mut result = vec![vec![0.0; rows]; cols];
    for i in 0..rows {
        for j in 0..cols {
            result[j][i] = matrix[i][j];
        }
    }
    result
}

fn multiply_matrices(a: &[Vec<f64>], b: &[Vec<f64>]) -> Vec<Vec<f64>> {
    let m = a.len();
    let n = b[0].len();
    let p = b.len();
    let mut result = vec![vec![0.0; n]; m];
    for i in 0..m {
        for j in 0..n {
            for k in 0..p {
                result[i][j] += a[i][k] * b[k][j];
            }
        }
    }
    result
}

fn matrix_inverse(matrix: &[Vec<f64>]) -> Option<Vec<Vec<f64>>> {
    let n = matrix.len();
    let mut aug = vec![vec![0.0; 2 * n]; n];

    for i in 0..n {
        for j in 0..n {
            aug[i][j] = matrix[i][j];
        }
        aug[i][n + i] = 1.0;
    }

    for col in 0..n {
        let mut pivot_row = col;
        for row in col..n {
            if aug[row][col].abs() > aug[pivot_row][col].abs() {
                pivot_row = row;
            }
        }

        if aug[pivot_row][col].abs() < 1e-10 {
            return None;
        }

        aug.swap(col, pivot_row);

        let div = aug[col][col];
        for j in 0..2 * n {
            aug[col][j] /= div;
        }

        for row in 0..n {
            if row != col {
                let factor = aug[row][col];
                for j in 0..2 * n {
                    aug[row][j] -= factor * aug[col][j];
                }
            }
        }
    }

    let mut inv = vec![vec![0.0; n]; n];
    for i in 0..n {
        for j in 0..n {
            inv[i][j] = aug[i][n + j];
        }
    }

    Some(inv)
}

pub fn savgol_filter(signal: &Array1<f64>, window_size: usize, poly_order: usize) -> Array1<f64> {
    let n = signal.len();
    let mut result = Array1::zeros(n);

    if n < window_size {
        return signal.clone();
    }

    let coeffs = savgol_coefficients(window_size, poly_order);
    let half = (window_size - 1) / 2;

    for i in 0..n {
        let mut sum = 0.0;
        for k in 0..window_size {
            let idx = (i as isize + k as isize - half as isize).max(0).min(n as isize - 1) as usize;
            sum += signal[idx] * coeffs[k];
        }
        result[i] = sum;
    }

    result
}

pub fn exponential_smoothing(signal: &Array1<f64>, alpha: f64) -> Array1<f64> {
    let n = signal.len();
    let mut result = Array1::zeros(n);

    if n == 0 {
        return result;
    }

    result[0] = signal[0];
    for i in 1..n {
        result[i] = alpha * signal[i] + (1.0 - alpha) * result[i - 1];
    }

    result
}

pub fn moving_average(signal: &Array1<f64>, window_size: usize) -> Array1<f64> {
    let n = signal.len();
    let mut result = Array1::zeros(n);

    if n < window_size {
        return signal.clone();
    }

    let half = window_size / 2;
    for i in 0..n {
        let mut sum = 0.0;
        let mut count = 0;
        for k in 0..window_size {
            let idx = (i as isize + k as isize - half as isize).max(0).min(n as isize - 1) as usize;
            sum += signal[idx];
            count += 1;
        }
        result[i] = sum / count as f64;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;

    #[test]
    fn test_moving_average() {
        let signal = Array1::from_vec(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
        let smoothed = moving_average(&signal, 3);
        assert_abs_diff_eq!(smoothed[2], 3.0, epsilon = 0.1);
    }

    #[test]
    fn test_exponential_smoothing() {
        let signal = Array1::from_vec(vec![1.0, 1.0, 1.0, 1.0]);
        let smoothed = exponential_smoothing(&signal, 0.5);
        assert_abs_diff_eq!(smoothed[3], 1.0, epsilon = 0.1);
    }
}
