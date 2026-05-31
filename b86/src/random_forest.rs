use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use rand::Rng;
use rand_distr::{Normal, Distribution};

const LITHOLOGY_TYPES: [&str; 6] = [
    "Sandstone",
    "Shale",
    "Limestone",
    "Dolomite",
    "Coal",
    "Siltstone"
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sample {
    pub features: Vec<f64>,
    pub label: usize,
    pub depth: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub feature_idx: usize,
    pub threshold: f64,
    pub left: Option<Box<Node>>,
    pub right: Option<Box<Node>>,
    pub prediction: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionTree {
    root: Option<Node>,
    max_depth: usize,
    min_samples_split: usize,
    n_features: usize,
}

impl DecisionTree {
    pub fn new(max_depth: usize, min_samples_split: usize) -> Self {
        DecisionTree {
            root: None,
            max_depth,
            min_samples_split,
            n_features: 0,
        }
    }

    pub fn fit(&mut self, samples: &[Sample], n_features: usize) {
        self.n_features = n_features;
        self.root = Some(self.build_tree(samples, 0));
    }

    fn build_tree(&self, samples: &[Sample], depth: usize) -> Node {
        let n_samples = samples.len();
        let n_classes = LITHOLOGY_TYPES.len();

        if depth >= self.max_depth || n_samples < self.min_samples_split {
            return Node {
                feature_idx: 0,
                threshold: 0.0,
                left: None,
                right: None,
                prediction: Some(self.calculate_probabilities(samples)),
            };
        }

        let mut best_gain = -1.0;
        let mut best_feature = 0;
        let mut best_threshold = 0.0;

        let mut rng = rand::thread_rng();
        let mut features: Vec<usize> = (0..self.n_features).collect();
        let n_subset = (self.n_features as f64).sqrt() as usize;
        
        for _ in 0..n_subset {
            let idx = rng.gen_range(0..features.len());
            let f_idx = features[idx];
            
            let values: HashSet<f64> = samples.iter().map(|s| s.features[f_idx]).collect();
            let mut sorted_values: Vec<f64> = values.into_iter().collect();
            sorted_values.sort_by(|a, b| a.partial_cmp(b).unwrap());

            for i in 0..sorted_values.len()-1 {
                let threshold = (sorted_values[i] + sorted_values[i+1]) / 2.0;
                let gain = self.information_gain(samples, f_idx, threshold);
                
                if gain > best_gain {
                    best_gain = gain;
                    best_feature = f_idx;
                    best_threshold = threshold;
                }
            }
        }

        if best_gain <= 0.01 {
            return Node {
                feature_idx: 0,
                threshold: 0.0,
                left: None,
                right: None,
                prediction: Some(self.calculate_probabilities(samples)),
            };
        }

        let (left_samples, right_samples) = self.split(samples, best_feature, best_threshold);

        Node {
            feature_idx: best_feature,
            threshold: best_threshold,
            left: Some(Box::new(self.build_tree(&left_samples, depth + 1))),
            right: Some(Box::new(self.build_tree(&right_samples, depth + 1))),
            prediction: None,
        }
    }

    fn split<'a>(&self, samples: &'a [Sample], feature_idx: usize, threshold: f64) -> (Vec<Sample>, Vec<Sample>) {
        let mut left = Vec::new();
        let mut right = Vec::new();

        for sample in samples {
            if sample.features[feature_idx] <= threshold {
                left.push(sample.clone());
            } else {
                right.push(sample.clone());
            }
        }

        (left, right)
    }

    fn information_gain(&self, samples: &[Sample], feature_idx: usize, threshold: f64) -> f64 {
        let (left, right) = self.split(samples, feature_idx, threshold);
        
        if left.is_empty() || right.is_empty() {
            return 0.0;
        }

        let parent_gini = self.gini(samples);
        let left_gini = self.gini(&left);
        let right_gini = self.gini(&right);

        let n = samples.len() as f64;
        let n_left = left.len() as f64;
        let n_right = right.len() as f64;

        let child_gini = (n_left / n) * left_gini + (n_right / n) * right_gini;
        parent_gini - child_gini
    }

    fn gini(&self, samples: &[Sample]) -> f64 {
        let mut counts = vec![0; LITHOLOGY_TYPES.len()];
        for sample in samples {
            counts[sample.label] += 1;
        }

        let n = samples.len() as f64;
        let mut impurity = 1.0;
        for &count in &counts {
            let p = count as f64 / n;
            impurity -= p * p;
        }
        impurity
    }

    fn calculate_probabilities(&self, samples: &[Sample]) -> Vec<f64> {
        let mut counts = vec![0; LITHOLOGY_TYPES.len()];
        for sample in samples {
            counts[sample.label] += 1;
        }

        let n = samples.len().max(1) as f64;
        counts.iter().map(|&c| c as f64 / n).collect()
    }

    pub fn predict_proba(&self, features: &[f64]) -> Vec<f64> {
        if let Some(ref root) = self.root {
            self.predict_node(root, features)
        } else {
            vec![1.0 / LITHOLOGY_TYPES.len() as f64; LITHOLOGY_TYPES.len()]
        }
    }

    fn predict_node(&self, node: &Node, features: &[f64]) -> Vec<f64> {
        if let Some(ref pred) = node.prediction {
            return pred.clone();
        }

        if features[node.feature_idx] <= node.threshold {
            if let Some(ref left) = node.left {
                self.predict_node(left, features)
            } else {
                vec![1.0 / LITHOLOGY_TYPES.len() as f64; LITHOLOGY_TYPES.len()]
            }
        } else {
            if let Some(ref right) = node.right {
                self.predict_node(right, features)
            } else {
                vec![1.0 / LITHOLOGY_TYPES.len() as f64; LITHOLOGY_TYPES.len()]
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RandomForest {
    trees: Vec<DecisionTree>,
    n_trees: usize,
    max_depth: usize,
    min_samples_split: usize,
    feature_means: Vec<f64>,
    feature_stds: Vec<f64>,
}

impl RandomForest {
    pub fn new(n_trees: usize, max_depth: usize, min_samples_split: usize) -> Self {
        RandomForest {
            trees: Vec::new(),
            n_trees,
            max_depth,
            min_samples_split,
            feature_means: Vec::new(),
            feature_stds: Vec::new(),
        }
    }

    pub fn fit(&mut self, samples: &[Sample]) {
        if samples.is_empty() {
            return;
        }

        let n_features = samples[0].features.len();
        self.calculate_statistics(samples, n_features);

        let normalized_samples = self.normalize_samples(samples);

        self.trees.clear();
        let mut rng = rand::thread_rng();

        for _ in 0..self.n_trees {
            let bootstrap_sample = self.bootstrap_sample(&normalized_samples, &mut rng);
            
            let mut tree = DecisionTree::new(self.max_depth, self.min_samples_split);
            tree.fit(&bootstrap_sample, n_features);
            self.trees.push(tree);
        }
    }

    fn calculate_statistics(&mut self, samples: &[Sample], n_features: usize) {
        self.feature_means = vec![0.0; n_features];
        self.feature_stds = vec![0.0; n_features];

        for f in 0..n_features {
            let values: Vec<f64> = samples.iter().map(|s| s.features[f]).collect();
            let mean = values.iter().sum::<f64>() / values.len() as f64;
            let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / values.len() as f64;
            
            self.feature_means[f] = mean;
            self.feature_stds[f] = variance.sqrt().max(0.0001);
        }
    }

    fn normalize_samples(&self, samples: &[Sample]) -> Vec<Sample> {
        samples.iter().map(|s| {
            let mut normalized_features = vec![0.0; s.features.len()];
            for (f, &val) in s.features.iter().enumerate() {
                normalized_features[f] = (val - self.feature_means[f]) / self.feature_stds[f];
            }
            Sample {
                features: normalized_features,
                label: s.label,
                depth: s.depth,
            }
        }).collect()
    }

    fn bootstrap_sample(&self, samples: &[Sample], rng: &mut impl Rng) -> Vec<Sample> {
        let n = samples.len();
        (0..n).map(|_| samples[rng.gen_range(0..n)].clone()).collect()
    }

    pub fn predict_proba(&self, features: &[f64]) -> Vec<f64> {
        if self.trees.is_empty() {
            return vec![1.0 / LITHOLOGY_TYPES.len() as f64; LITHOLOGY_TYPES.len()];
        }

        let normalized_features: Vec<f64> = features.iter().enumerate()
            .map(|(f, &val)| (val - self.feature_means[f]) / self.feature_stds[f])
            .collect();

        let mut avg_probs = vec![0.0; LITHOLOGY_TYPES.len()];
        for tree in &self.trees {
            let probs = tree.predict_proba(&normalized_features);
            for (i, &p) in probs.iter().enumerate() {
                avg_probs[i] += p;
            }
        }

        avg_probs.iter().map(|&p| p / self.trees.len() as f64).collect()
    }

    pub fn predict(&self, features: &[f64]) -> usize {
        let probs = self.predict_proba(features);
        probs.iter().enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .map(|(i, _)| i)
            .unwrap_or(0)
    }

    pub fn incremental_fit(&mut self, new_samples: &[Sample], old_weight: f64) {
        if new_samples.is_empty() {
            return;
        }

        let mut combined_samples = Vec::new();
        let n_features = new_samples[0].features.len();
        
        self.calculate_statistics(new_samples, n_features);
        let normalized_new = self.normalize_samples(new_samples);
        
        let mut rng = rand::thread_rng();
        
        for tree in &mut self.trees {
            let bootstrap = self.bootstrap_sample(&normalized_new, &mut rng);
            for s in &bootstrap {
                combined_samples.push(s.clone());
            }
        }
        
        if !combined_samples.is_empty() {
            self.fit(&combined_samples);
        }
    }
}

pub fn lithology_name(index: usize) -> &'static str {
    LITHOLOGY_TYPES.get(index).copied().unwrap_or("Unknown")
}

pub fn lithology_index(name: &str) -> usize {
    LITHOLOGY_TYPES.iter()
        .position(|&l| l.eq_ignore_ascii_case(name))
        .unwrap_or(0)
}

pub fn get_lithology_color(lithology: &str) -> &'static str {
    match lithology {
        "Sandstone" => "#e67e22",
        "Shale" => "#7f8c8d",
        "Limestone" => "#3498db",
        "Dolomite" => "#9b59b6",
        "Coal" => "#2c3e50",
        "Siltstone" => "#d35400",
        _ => "#808080",
    }
}
