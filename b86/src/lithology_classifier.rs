use crate::random_forest::{RandomForest, Sample, lithology_name, lithology_index, LITHOLOGY_TYPES};
use ndarray::{Array1, s};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LithologyPrediction {
    pub depth: f64,
    pub lithology: String,
    pub confidence: f64,
    pub probabilities: Vec<f64>,
    pub is_user_labeled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationResult {
    pub predictions: Vec<LithologyPrediction>,
    pub feature_importance: HashMap<String, f64>,
    pub model_info: ModelInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub n_trees: usize,
    pub max_depth: usize,
    pub total_samples: usize,
    pub user_labeled_samples: usize,
}

pub fn extract_features(
    gr: &Array1<f64>,
    rt: &Array1<f64>,
    dt: &Array1<f64>,
    depth: &Array1<f64>,
    index: usize,
    window_size: usize,
) -> Vec<f64> {
    let n = gr.len();
    let half = window_size / 2;
    let start = (index as isize - half as isize).max(0) as usize;
    let end = (index + half).min(n - 1);

    let gr_window = gr.slice(s![start..=end]);
    let rt_window = rt.slice(s![start..=end]);
    let dt_window = dt.slice(s![start..=end]);

    let gr_mean = gr_window.mean().unwrap_or(0.0);
    let gr_std = gr_window.std(0.0);
    let gr_min = gr_window.iter().fold(f64::INFINITY, |a, &b| a.min(b));
    let gr_max = gr_window.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
    let gr_range = gr_max - gr_min;
    let gr_median = percentile(&gr_window.to_vec(), 50.0);
    let gr_variance = gr_std * gr_std;

    let rt_mean = rt_window.mean().unwrap_or(0.0);
    let rt_std = rt_window.std(0.0);
    let rt_min = rt_window.iter().fold(f64::INFINITY, |a, &b| a.min(b));
    let rt_max = rt_window.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
    let rt_range = rt_max - rt_min;
    let rt_median = percentile(&rt_window.to_vec(), 50.0);
    let rt_log_mean = rt_window.mapv(|x| x.ln()).mean().unwrap_or(0.0);

    let dt_mean = dt_window.mean().unwrap_or(0.0);
    let dt_std = dt_window.std(0.0);
    let dt_min = dt_window.iter().fold(f64::INFINITY, |a, &b| a.min(b));
    let dt_max = dt_window.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
    let dt_range = dt_max - dt_min;
    let dt_median = percentile(&dt_window.to_vec(), 50.0);

    let porosity = (dt_mean - 55.0) / (180.0 - 55.0);
    let vshale = (gr_mean - 20.0) / (100.0 - 20.0).max(0.01);

    let gr_rt_ratio = if rt_mean > 0.0 { gr_mean / rt_mean } else { 0.0 };
    let gr_dt_ratio = if dt_mean > 0.0 { gr_mean / dt_mean } else { 0.0 };
    let rt_dt_ratio = if dt_mean > 0.0 { rt_mean / dt_mean } else { 0.0 };

    let gr_grad = if index > 0 && index < n - 1 {
        (gr[index + 1] - gr[index - 1]) / (depth[index + 1] - depth[index - 1]).max(0.01)
    } else {
        0.0
    };

    let rt_grad = if index > 0 && index < n - 1 {
        (rt[index + 1] - rt[index - 1]) / (depth[index + 1] - depth[index - 1]).max(0.01)
    } else {
        0.0
    };

    let dt_grad = if index > 0 && index < n - 1 {
        (dt[index + 1] - dt[index - 1]) / (depth[index + 1] - depth[index - 1]).max(0.01)
    } else {
        0.0
    };

    vec![
        gr[index], gr_mean, gr_std, gr_min, gr_max, gr_range, gr_median, gr_variance, gr_grad,
        rt[index], rt_mean, rt_std, rt_min, rt_max, rt_range, rt_median, rt_log_mean, rt_grad,
        dt[index], dt_mean, dt_std, dt_min, dt_max, dt_range, dt_median, dt_grad,
        porosity, vshale, gr_rt_ratio, gr_dt_ratio, rt_dt_ratio,
    ]
}

fn percentile(data: &[f64], p: f64) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    
    let mut sorted = data.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    
    let idx = (p / 100.0 * (sorted.len() - 1) as f64).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

pub fn create_training_samples(
    gr: &Array1<f64>,
    rt: &Array1<f64>,
    dt: &Array1<f64>,
    depth: &Array1<f64>,
    labels: &[(f64, f64, &str)],
) -> Vec<Sample> {
    let mut samples = Vec::new();
    let window_size = 5;

    for (top, bottom, lithology) in labels {
        let label = lithology_index(lithology);
        for (i, &d) in depth.iter().enumerate() {
            if d >= *top && d <= *bottom {
                let features = extract_features(gr, rt, dt, depth, i, window_size);
                samples.push(Sample { features, label, depth: d });
            }
        }
    }

    samples
}

pub fn create_synthetic_training_data() -> Vec<Sample> {
    let mut samples = Vec::new();
    let mut rng = rand::thread_rng();

    let lithology_params = [
        ("Sandstone", 40.0, 10.0, 5.0, 2.0, 65.0, 8.0),
        ("Shale", 90.0, 15.0, 2.0, 0.8, 75.0, 10.0),
        ("Limestone", 25.0, 8.0, 15.0, 5.0, 50.0, 5.0),
        ("Dolomite", 30.0, 10.0, 20.0, 8.0, 48.0, 4.0),
        ("Coal", 70.0, 20.0, 50.0, 15.0, 120.0, 20.0),
        ("Siltstone", 60.0, 12.0, 3.5, 1.5, 68.0, 9.0),
    ];

    for (lithology, gr_mean, gr_std, rt_mean, rt_std, dt_mean, dt_std) in lithology_params {
        let label = lithology_index(lithology);
        let normal_gr = rand_distr::Normal::new(gr_mean, gr_std).unwrap();
        let normal_rt = rand_distr::Normal::new(rt_mean, rt_std).unwrap();
        let normal_dt = rand_distr::Normal::new(dt_mean, dt_std).unwrap();

        for _ in 0..100 {
            let gr_val = normal_gr.sample(&mut rng).max(0.0);
            let rt_val = normal_rt.sample(&mut rng).max(0.1);
            let dt_val = normal_dt.sample(&mut rng).max(20.0);

            let gr_array = Array1::from_vec(vec![gr_val; 5]);
            let rt_array = Array1::from_vec(vec![rt_val; 5]);
            let dt_array = Array1::from_vec(vec![dt_val; 5]);
            let depth_array = Array1::from_vec(vec![0.0, 0.1, 0.2, 0.3, 0.4]);

            let features = extract_features(&gr_array, &rt_array, &dt_array, &depth_array, 2, 3);
            samples.push(Sample { features, label, depth: 0.0 });
        }
    }

    samples
}

pub struct LithologyClassifier {
    model: RandomForest,
    user_labels: Vec<(f64, f64, String)>,
    is_trained: bool,
}

impl LithologyClassifier {
    pub fn new() -> Self {
        let mut model = RandomForest::new(50, 10, 5);
        let training_data = create_synthetic_training_data();
        model.fit(&training_data);

        LithologyClassifier {
            model,
            user_labels: Vec::new(),
            is_trained: true,
        }
    }

    pub fn predict(
        &self,
        gr: &Array1<f64>,
        rt: &Array1<f64>,
        dt: &Array1<f64>,
        depth: &Array1<f64>,
    ) -> Vec<LithologyPrediction> {
        let window_size = 5;
        let mut predictions = Vec::new();

        for i in 0..gr.len() {
            let features = extract_features(gr, rt, dt, depth, i, window_size);
            let probabilities = self.model.predict_proba(&features);
            let label_idx = self.model.predict(&features);
            let confidence = probabilities[label_idx];

            let is_user_labeled = self.user_labels.iter().any(|(top, bottom, _)| {
                depth[i] >= *top && depth[i] <= *bottom
            });

            let final_label = if is_user_labeled {
                self.user_labels.iter()
                    .find(|(top, bottom, _)| depth[i] >= *top && depth[i] <= *bottom)
                    .map(|(_, _, l)| l.clone())
                    .unwrap_or_else(|| lithology_name(label_idx).to_string())
            } else {
                lithology_name(label_idx).to_string()
            };

            predictions.push(LithologyPrediction {
                depth: depth[i],
                lithology: final_label,
                confidence,
                probabilities,
                is_user_labeled,
            });
        }

        predictions
    }

    pub fn add_user_label(&mut self, top: f64, bottom: f64, lithology: String) {
        self.user_labels.retain(|(t, b, _)| !(*t <= bottom && *b >= top));
        self.user_labels.push((top, bottom, lithology));
    }

    pub fn retrain_with_user_labels(
        &mut self,
        gr: &Array1<f64>,
        rt: &Array1<f64>,
        dt: &Array1<f64>,
        depth: &Array1<f64>,
    ) -> usize {
        let labels: Vec<(f64, f64, &str)> = self.user_labels
            .iter()
            .map(|(t, b, l)| (*t, *b, l.as_str()))
            .collect();

        if labels.is_empty() {
            return 0;
        }

        let user_samples = create_training_samples(gr, rt, dt, depth, &labels);
        let n_samples = user_samples.len();

        self.model.incremental_fit(&user_samples, 0.7);
        n_samples
    }

    pub fn get_model_info(&self) -> ModelInfo {
        ModelInfo {
            n_trees: self.model.n_trees,
            max_depth: self.model.max_depth,
            total_samples: self.model.n_trees * 100,
            user_labeled_samples: self.user_labels.len(),
        }
    }

    pub fn get_user_labels(&self) -> &Vec<(f64, f64, String)> {
        &self.user_labels
    }
}

impl Default for LithologyClassifier {
    fn default() -> Self {
        Self::new()
    }
}

pub fn get_lithology_types() -> Vec<String> {
    LITHOLOGY_TYPES.iter().map(|s| s.to_string()).collect()
}
