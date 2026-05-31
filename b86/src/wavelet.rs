use crate::Result;
use ndarray::{Array1, ArrayView1};
use std::f64::consts::SQRT_2;

fn daubechies4_coeffs() -> (Vec<f64>, Vec<f64>) {
    let h0 = (1.0 + 3.0f64.sqrt()) / (4.0 * SQRT_2);
    let h1 = (3.0 + 3.0f64.sqrt()) / (4.0 * SQRT_2);
    let h2 = (3.0 - 3.0f64.sqrt()) / (4.0 * SQRT_2);
    let h3 = (1.0 - 3.0f64.sqrt()) / (4.0 * SQRT_2);

    let low = vec![h0, h1, h2, h3];
    let high = vec![h3, -h2, h1, -h0];
    (low, high)
}

fn dwt_1d(signal: &[f64], low: &[f64], high: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let n = signal.len();
    let filt_len = low.len();
    let half = (n + filt_len - 1) / 2;

    let mut approx = Vec::with_capacity(half);
    let mut detail = Vec::with_capacity(half);

    for i in 0..half {
        let mut a = 0.0;
        let mut d = 0.0;
        for k in 0..filt_len {
            let idx = (2 * i + k) % n;
            a += signal[idx] * low[k];
            d += signal[idx] * high[k];
        }
        approx.push(a);
        detail.push(d);
    }

    (approx, detail)
}

fn idwt_1d(approx: &[f64], detail: &[f64], low: &[f64], high: &[f64]) -> Vec<f64> {
    let n = approx.len();
    let filt_len = low.len();
    let out_len = 2 * n;

    let mut reconstructed = vec![0.0; out_len];

    for i in 0..n {
        for k in 0..filt_len {
            let idx = (2 * i + k) % out_len;
            reconstructed[idx] += approx[i] * low[k] + detail[i] * high[k];
        }
    }

    reconstructed
}

fn multi_level_dwt(signal: &[f64], levels: usize) -> Vec<Vec<f64>> {
    let (low, high) = daubechies4_coeffs();
    let mut coefficients = Vec::with_capacity(levels + 1);
    let mut current = signal.to_vec();

    for _ in 0..levels {
        let (approx, detail) = dwt_1d(&current, &low, &high);
        coefficients.push(detail);
        current = approx;
    }
    coefficients.push(current);

    coefficients
}

fn multi_level_idwt(coefficients: &[Vec<f64>]) -> Vec<f64> {
    let (low, high) = daubechies4_coeffs();
    let levels = coefficients.len() - 1;
    let mut current = coefficients[levels].clone();

    for i in (0..levels).rev() {
        let detail = &coefficients[i];
        current = idwt_1d(&current, detail, &low, &high);
    }

    current
}

fn calculate_threshold(detail: &[f64]) -> f64 {
    let mad = median_absolute_deviation(detail);
    let sigma = mad / 0.6745;
    sigma * (2.0 * (detail.len() as f64).ln()).sqrt()
}

fn median_absolute_deviation(data: &[f64]) -> f64 {
    let mut sorted = data.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    
    let median = if sorted.len() % 2 == 1 {
        sorted[sorted.len() / 2]
    } else {
        (sorted[sorted.len() / 2 - 1] + sorted[sorted.len() / 2]) / 2.0
    };

    let mut deviations: Vec<f64> = sorted.iter().map(|&x| (x - median).abs()).collect();
    deviations.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    if deviations.len() % 2 == 1 {
        deviations[deviations.len() / 2]
    } else {
        (deviations[deviations.len() / 2 - 1] + deviations[deviations.len() / 2]) / 2.0
    }
}

fn soft_threshold(value: f64, threshold: f64) -> f64 {
    if value.abs() > threshold {
        value.signum() * (value.abs() - threshold)
    } else {
        0.0
    }
}

pub fn wavelet_denoise(signal: &Array1<f64>, levels: Option<usize>) -> Result<Array1<f64>> {
    let signal_vec: Vec<f64> = signal.iter().cloned().collect();
    let n = signal_vec.len();
    
    let levels = levels.unwrap_or_else(|| {
        ((n as f64).ln() / 2.0f64.ln()).floor() as usize - 1
    });

    let pad_len = if n % (1 << levels) != 0 {
        (1 << levels) - n % (1 << levels)
    } else {
        0
    };

    let mut padded = signal_vec.clone();
    padded.extend(std::iter::repeat(0.0).take(pad_len));

    let mut coefficients = multi_level_dwt(&padded, levels);

    for i in 0..levels {
        let threshold = calculate_threshold(&coefficients[i]);
        coefficients[i] = coefficients[i]
            .iter()
            .map(|&x| soft_threshold(x, threshold))
            .collect();
    }

    let mut denoised = multi_level_idwt(&coefficients);
    denoised.truncate(n);

    Ok(Array1::from_vec(denoised))
}

pub fn calculate_snr(original: &Array1<f64>, denoised: &Array1<f64>) -> f64 {
    let noise: Vec<f64> = original
        .iter()
        .zip(denoised.iter())
        .map(|(o, d)| o - d)
        .collect();

    let signal_power = original.iter().map(|&x| x * x).sum::<f64>() / original.len() as f64;
    let noise_power = noise.iter().map(|&x| x * x).sum::<f64>() / noise.len() as f64;

    if noise_power == 0.0 {
        return f64::INFINITY;
    }

    10.0 * (signal_power / noise_power).log10()
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;

    #[test]
    fn test_wavelet_denoise() {
        let n = 256;
        let mut signal = Vec::with_capacity(n);
        for i in 0..n {
            let x = i as f64 / n as f64;
            signal.push((x * 8.0 * std::f64::consts::PI).sin());
        }

        use rand::Rng;
        let mut rng = rand::thread_rng();
        let noisy: Vec<f64> = signal
            .iter()
            .map(|&s| s + rng.gen_range(-0.1..0.1))
            .collect();

        let signal_arr = Array1::from_vec(signal);
        let noisy_arr = Array1::from_vec(noisy);

        let denoised = wavelet_denoise(&noisy_arr, Some(4)).unwrap();
        let snr = calculate_snr(&signal_arr, &denoised);

        assert!(snr > 10.0, "SNR should be at least 10dB, got {}", snr);
    }
}
