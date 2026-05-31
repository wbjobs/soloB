use crate::pelt::Formations;
use crate::Result;
use ndarray::Array1;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrelatedFormation {
    pub name: String,
    pub wells: HashMap<String, (f64, f64)>,
    pub lithology: String,
    pub correlation_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WellCorrelation {
    pub field_name: String,
    pub wells: Vec<String>,
    pub correlated_formations: Vec<CorrelatedFormation>,
    pub correlation_matrix: Vec<Vec<f64>>,
}

fn formation_signature(
    gr: &Array1<f64>,
    rt: &Array1<f64>,
    dt: &Array1<f64>,
    depth: &Array1<f64>,
    top: f64,
    bottom: f64,
) -> Vec<f64> {
    let start_idx = depth
        .iter()
        .position(|&d| d >= top)
        .unwrap_or(0);
    let end_idx = depth
        .iter()
        .rposition(|&d| d <= bottom)
        .unwrap_or(depth.len() - 1);

    if start_idx >= end_idx {
        return vec![0.0; 12];
    }

    let gr_slice = gr.slice(s![start_idx..=end_idx]);
    let rt_slice = rt.slice(s![start_idx..=end_idx]);
    let dt_slice = dt.slice(s![start_idx..=end_idx]);

    vec![
        gr_slice.mean().unwrap_or(0.0),
        gr_slice.std(0.0),
        gr_slice.iter().fold(f64::INFINITY, |a, &b| a.min(b)),
        gr_slice.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b)),
        rt_slice.mean().unwrap_or(0.0),
        rt_slice.std(0.0),
        rt_slice.iter().fold(f64::INFINITY, |a, &b| a.min(b)),
        rt_slice.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b)),
        dt_slice.mean().unwrap_or(0.0),
        dt_slice.std(0.0),
        dt_slice.iter().fold(f64::INFINITY, |a, &b| a.min(b)),
        dt_slice.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b)),
    ]
}

fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    if a.len() != b.len() {
        return 0.0;
    }

    let dot_product: f64 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let norm_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        0.0
    } else {
        dot_product / (norm_a * norm_b)
    }
}

pub fn correlate_wells(
    well_data: &[(String, Formations, Array1<f64>, Array1<f64>, Array1<f64>, Array1<f64>)],
) -> Result<WellCorrelation> {
    if well_data.is_empty() {
        return Ok(WellCorrelation {
            field_name: "Unknown".to_string(),
            wells: Vec::new(),
            correlated_formations: Vec::new(),
            correlation_matrix: Vec::new(),
        });
    }

    let wells: Vec<String> = well_data.iter().map(|(name, _, _, _, _, _)| name.clone()).collect();
    let n_wells = wells.len();

    let mut all_formations: Vec<(String, String, f64, f64, Vec<f64>)> = Vec::new();

    for (well_name, formations, depth, gr, rt, dt) in well_data {
        for formation in &formations.formations {
            let signature = formation_signature(
                gr,
                rt,
                dt,
                depth,
                formation.top_depth,
                formation.bottom_depth,
            );
            all_formations.push((
                well_name.clone(),
                formation.lithology.clone(),
                formation.top_depth,
                formation.bottom_depth,
                signature,
            ));
        }
    }

    let mut clusters: Vec<Vec<usize>> = Vec::new();
    let threshold = 0.7;

    for (i, (_, _, _, _, sig_i)) in all_formations.iter().enumerate() {
        let mut best_cluster = None;
        let mut best_score = 0.0;

        for (c_idx, cluster) in clusters.iter().enumerate() {
            let mut avg_score = 0.0;
            for &j in cluster {
                avg_score += cosine_similarity(sig_i, &all_formations[j].4);
            }
            avg_score /= cluster.len() as f64;

            if avg_score > best_score && avg_score > threshold {
                best_score = avg_score;
                best_cluster = Some(c_idx);
            }
        }

        if let Some(c_idx) = best_cluster {
            clusters[c_idx].push(i);
        } else {
            clusters.push(vec![i]);
        }
    }

    let mut correlated_formations = Vec::new();
    for (idx, cluster) in clusters.into_iter().enumerate() {
        if cluster.is_empty() {
            continue;
        }

        let mut wells_map = HashMap::new();
        let mut lithologies = HashMap::new();
        let mut scores = Vec::new();

        for &i in &cluster {
            let (well_name, lithology, top, bottom, _) = &all_formations[i];
            wells_map.insert(well_name.clone(), (*top, *bottom));
            *lithologies.entry(lithology.clone()).or_insert(0) += 1;
        }

        for &i in &cluster {
            for &j in &cluster {
                if i != j {
                    scores.push(cosine_similarity(
                        &all_formations[i].4,
                        &all_formations[j].4,
                    ));
                }
            }
        }

        let dominant_lithology = lithologies
            .into_iter()
            .max_by_key(|&(_, count)| count)
            .map(|(l, _)| l)
            .unwrap_or_else(|| "Unknown".to_string());

        let avg_score = if scores.is_empty() {
            1.0
        } else {
            scores.iter().sum::<f64>() / scores.len() as f64
        };

        correlated_formations.push(CorrelatedFormation {
            name: format!("Zone_{}", idx + 1),
            wells: wells_map,
            lithology: dominant_lithology,
            correlation_score: avg_score,
        });
    }

    let mut correlation_matrix = vec![vec![0.0; n_wells]; n_wells];
    for i in 0..n_wells {
        correlation_matrix[i][i] = 1.0;
        for j in (i + 1)..n_wells {
            let formations_i = &well_data[i].1.formations;
            let formations_j = &well_data[j].1.formations;

            let mut matched = 0;
            for fi in formations_i {
                for fj in formations_j {
                    if fi.lithology == fj.lithology {
                        matched += 1;
                        break;
                    }
                }
            }

            let similarity = if !formations_i.is_empty() {
                matched as f64 / formations_i.len() as f64
            } else {
                0.0
            };

            correlation_matrix[i][j] = similarity;
            correlation_matrix[j][i] = similarity;
        }
    }

    Ok(WellCorrelation {
        field_name: "Field".to_string(),
        wells,
        correlated_formations,
        correlation_matrix,
    })
}
