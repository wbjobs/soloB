use crate::smooth::savgol_filter;
use crate::Result;
use ndarray::Array1;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Formation {
    pub name: String,
    pub top_depth: f64,
    pub bottom_depth: f64,
    pub lithology: String,
    pub gr_mean: f64,
    pub rt_mean: f64,
    pub dt_mean: f64,
    pub thickness: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Formations {
    pub well_name: String,
    pub formations: Vec<Formation>,
    pub num_merged: usize,
}

fn mean(data: &[f64]) -> f64 {
    if data.is_empty() {
        0.0
    } else {
        data.iter().sum::<f64>() / data.len() as f64
    }
}

fn variance(data: &[f64], m: f64) -> f64 {
    if data.len() <= 1 {
        0.0
    } else {
        data.iter().map(|&x| (x - m).powi(2)).sum::<f64>() / data.len() as f64
    }
}

fn cost(data: &[f64]) -> f64 {
    let m = mean(data);
    let v = variance(data, m);
    if v <= 0.0 {
        0.0
    } else {
        data.len() as f64 * v.ln()
    }
}

pub fn pelt_changepoints(data: &[f64], penalty: f64, min_segment: usize) -> Vec<usize> {
    let n = data.len();
    if n < 2 * min_segment {
        return Vec::new();
    }

    let mut f = vec![0.0; n + 1];
    let mut cp = vec![0; n + 1];
    let mut candidates: Vec<usize> = (0..=n).collect();

    for t in (min_segment..=n).step_by(1) {
        let mut min_cost = f64::INFINITY;
        let mut best_cp = 0;

        for &s in &candidates {
            if s + min_segment > t {
                continue;
            }
            if t - s < min_segment {
                continue;
            }

            let segment = &data[s..t];
            let current_cost = f[s] + cost(segment) + penalty;

            if current_cost < min_cost {
                min_cost = current_cost;
                best_cp = s;
            }
        }

        f[t] = min_cost;
        cp[t] = best_cp;
    }

    let mut changepoints = Vec::new();
    let mut t = n;
    while t > 0 {
        changepoints.push(t);
        t = cp[t];
    }
    changepoints.reverse();
    changepoints.dedup();

    changepoints
        .into_iter()
        .filter(|&x| x > 0 && x < n)
        .collect()
}

fn estimate_penalty(data: &[f64]) -> f64 {
    let n = data.len() as f64;
    2.0 * n.ln() * 1.5
}

fn combine_changepoints(cp_lists: &[Vec<usize>], n: usize) -> Vec<usize> {
    let mut all_cp: Vec<usize> = cp_lists.iter().flatten().cloned().collect();
    if all_cp.is_empty() {
        return vec![n / 4, n / 2, 3 * n / 4];
    }

    let mut counts = HashMap::new();
    for &cp in &all_cp {
        *counts.entry(cp).or_insert(0) += 1;
    }

    let mut sorted_cp: Vec<(usize, usize)> = counts.into_iter().collect();
    sorted_cp.sort_by(|a, b| b.1.cmp(&a.1));

    let mut result: Vec<usize> = sorted_cp.into_iter().map(|(cp, _)| cp).take(10).collect();
    result.sort();
    result
}

pub fn merge_thin_layers(
    formations: &mut Vec<Formation>,
    depth: &Array1<f64>,
    gr: &Array1<f64>,
    rt: &Array1<f64>,
    dt: &Array1<f64>,
    min_thickness: f64,
) -> usize {
    if formations.len() <= 1 {
        return 0;
    }

    let mut merged = 0;
    let mut i = 0;

    while i < formations.len() - 1 {
        let thickness = formations[i].bottom_depth - formations[i].top_depth;

        if thickness < min_thickness {
            let remove_idx = if i == 0 {
                i + 1
            } else if i == formations.len() - 2 {
                i
            } else {
                let prev_thickness = formations[i - 1].bottom_depth - formations[i - 1].top_depth;
                let next_thickness = formations[i + 1].bottom_depth - formations[i + 1].top_depth;
                if prev_thickness < next_thickness {
                    i
                } else {
                    i + 1
                }
            };

            let mut merged_formation = if remove_idx == i + 1 {
                merge_two_formations(
                    &formations[i],
                    &formations[i + 1],
                    depth, gr, rt, dt
                )
            } else {
                merge_two_formations(
                    &formations[i - 1],
                    &formations[i],
                    depth, gr, rt, dt
                )
            };

            formations.remove(remove_idx);
            if remove_idx == i + 1 {
                formations[i] = merged_formation;
            } else {
                formations[i - 1] = merged_formation;
                i -= 1;
            }

            merged += 1;
        } else {
            i += 1;
        }
    }

    for (idx, f) in formations.iter_mut().enumerate() {
        f.name = format!("Formation_{}", idx + 1);
    }

    merged
}

fn merge_two_formations(
    f1: &Formation,
    f2: &Formation,
    depth: &Array1<f64>,
    gr: &Array1<f64>,
    rt: &Array1<f64>,
    dt: &Array1<f64>,
) -> Formation {
    let start_idx = depth
        .iter()
        .position(|&d| d >= f1.top_depth)
        .unwrap_or(0);
    let end_idx = depth
        .iter()
        .rposition(|&d| d <= f2.bottom_depth)
        .unwrap_or(depth.len() - 1);

    let gr_slice = gr.slice(s![start_idx..=end_idx]);
    let rt_slice = rt.slice(s![start_idx..=end_idx]);
    let dt_slice = dt.slice(s![start_idx..=end_idx]);

    let gr_mean = gr_slice.mean().unwrap_or(0.0);
    let rt_mean = rt_slice.mean().unwrap_or(0.0);
    let dt_mean = dt_slice.mean().unwrap_or(0.0);

    let lithology = predict_lithology(gr_mean, rt_mean, dt_mean);
    let thickness = f2.bottom_depth - f1.top_depth;

    Formation {
        name: f1.name.clone(),
        top_depth: f1.top_depth,
        bottom_depth: f2.bottom_depth,
        lithology: lithology.to_string(),
        gr_mean,
        rt_mean,
        dt_mean,
        thickness,
    }
}

fn predict_lithology(gr: f64, rt: f64, dt: f64) -> &'static str {
    if gr < 40.0 {
        if rt > 10.0 {
            "Limestone"
        } else if dt > 70.0 {
            "Sandstone"
        } else {
            "Dolomite"
        }
    } else if gr > 80.0 {
        if rt > 5.0 {
            "Coal"
        } else {
            "Shale"
        }
    } else {
        if dt > 65.0 {
            "Shaly Sand"
        } else {
            "Sandy Shale"
        }
    }
}

pub fn detect_changepoints(
    depth: &Array1<f64>,
    gr: &Array1<f64>,
    rt: &Array1<f64>,
    dt: &Array1<f64>,
    min_thickness: Option<f64>,
    smooth_window: Option<usize>,
) -> Result<Formations> {
    let n = depth.len();
    let min_thickness = min_thickness.unwrap_or(1.0);
    let window_size = smooth_window.unwrap_or(11);
    let poly_order = 2;

    let delta_z = (depth[n - 1] - depth[0]) / (n - 1) as f64;
    let min_segment_samples = (min_thickness / delta_z).ceil().max(5.0) as usize;

    let gr_smoothed = savgol_filter(gr, window_size, poly_order);
    let rt_smoothed = savgol_filter(rt, window_size, poly_order);
    let dt_smoothed = savgol_filter(dt, window_size, poly_order);

    let penalty_gr = estimate_penalty(gr_smoothed.as_slice().unwrap());
    let penalty_rt = estimate_penalty(rt_smoothed.as_slice().unwrap());
    let penalty_dt = estimate_penalty(dt_smoothed.as_slice().unwrap());

    let cp_gr = pelt_changepoints(gr_smoothed.as_slice().unwrap(), penalty_gr, min_segment_samples);
    let cp_rt = pelt_changepoints(rt_smoothed.as_slice().unwrap(), penalty_rt, min_segment_samples);
    let cp_dt = pelt_changepoints(dt_smoothed.as_slice().unwrap(), penalty_dt, min_segment_samples);

    let combined_cp = combine_changepoints(&[cp_gr, cp_rt, cp_dt], n);

    let mut segment_indices = vec![0]
        .into_iter()
        .chain(combined_cp)
        .chain(std::iter::once(n))
        .collect::<Vec<_>>();

    segment_indices.dedup();
    segment_indices.sort();

    let mut formations = Vec::new();

    for i in 0..segment_indices.len() - 1 {
        let start = segment_indices[i];
        let end = segment_indices[i + 1];
        if end - start < min_segment_samples {
            continue;
        }

        let top_depth = depth[start];
        let bottom_depth = depth[end - 1];
        let thickness = bottom_depth - top_depth;

        if thickness < min_thickness {
            continue;
        }

        let gr_slice = gr.slice(s![start..=end]);
        let rt_slice = rt.slice(s![start..=end]);
        let dt_slice = dt.slice(s![start..=end]);

        let gr_mean = gr_slice.mean().unwrap_or(0.0);
        let rt_mean = rt_slice.mean().unwrap_or(0.0);
        let dt_mean = dt_slice.mean().unwrap_or(0.0);

        let lithology = predict_lithology(gr_mean, rt_mean, dt_mean);

        formations.push(Formation {
            name: format!("Formation_{}", formations.len() + 1),
            top_depth,
            bottom_depth,
            lithology: lithology.to_string(),
            gr_mean,
            rt_mean,
            dt_mean,
            thickness,
        });
    }

    let num_merged = merge_thin_layers(&mut formations, depth, gr, rt, dt, min_thickness);

    Ok(Formations {
        well_name: "Well".to_string(),
        formations,
        num_merged,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pelt() {
        let mut data = Vec::new();
        for i in 0..100 {
            if i < 50 {
                data.push(1.0 + (i as f64 * 0.01).sin());
            } else {
                data.push(5.0 + (i as f64 * 0.01).sin());
            }
        }

        let cps = pelt_changepoints(&data, 10.0, 10);
        assert!(!cps.is_empty());
    }
}
