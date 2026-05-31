use crate::Result;
use ndarray::{Array1, Array2};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LasCurve {
    pub name: String,
    pub unit: String,
    pub description: String,
    pub data: Array1<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LasData {
    pub well_name: String,
    pub well_id: String,
    pub depth: Array1<f64>,
    pub curves: HashMap<String, LasCurve>,
    pub start_depth: f64,
    pub stop_depth: f64,
    pub step: f64,
}

impl LasData {
    pub fn new() -> Self {
        LasData {
            well_name: String::new(),
            well_id: String::new(),
            depth: Array1::zeros(0),
            curves: HashMap::new(),
            start_depth: 0.0,
            stop_depth: 0.0,
            step: 0.0,
        }
    }

    pub fn get_curve(&self, name: &str) -> Option<&LasCurve> {
        self.curves.get(name)
    }

    pub fn get_curve_names(&self) -> Vec<String> {
        self.curves.keys().cloned().collect()
    }
}

pub fn parse_las_file(file_path: &str) -> Result<LasData> {
    let file = File::open(file_path)?;
    let reader = BufReader::new(file);
    parse_las_reader(reader)
}

pub fn parse_las_reader<R: BufRead>(reader: R) -> Result<LasData> {
    let mut las_data = LasData::new();
    let mut section = String::new();
    let mut curve_info: Vec<(String, String, String)> = Vec::new();
    let mut data_lines: Vec<String> = Vec::new();

    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with('~') {
            section = trimmed.to_lowercase();
            continue;
        }

        match section.as_str() {
            s if s.contains("well") => {
                parse_well_section(&line, &mut las_data);
            }
            s if s.contains("curve") => {
                if let Some(info) = parse_curve_definition(&line) {
                    curve_info.push(info);
                }
            }
            s if s.contains("parameter") => {}
            s if s.contains("ascii") || s.contains("data") => {
                data_lines.push(line);
            }
            _ => {}
        }
    }

    process_data_section(&data_lines, &curve_info, &mut las_data)?;

    Ok(las_data)
}

fn parse_well_section(line: &str, las_data: &mut LasData) {
    let parts: Vec<&str> = line.splitn(2, '.').collect();
    if parts.len() < 2 {
        return;
    }

    let key = parts[0].trim().to_lowercase();
    let value_part = parts[1];
    
    let value = if let Some(colon_idx) = value_part.find(':') {
        value_part[..colon_idx].trim().to_string()
    } else {
        value_part.trim().to_string()
    };

    match key.as_str() {
        "strt" | "start" => {
            if let Ok(v) = value.parse::<f64>() {
                las_data.start_depth = v;
            }
        }
        "stop" => {
            if let Ok(v) = value.parse::<f64>() {
                las_data.stop_depth = v;
            }
        }
        "step" => {
            if let Ok(v) = value.parse::<f64>() {
                las_data.step = v;
            }
        }
        "well" => {
            las_data.well_name = value;
        }
        "api" | "uwi" => {
            las_data.well_id = value;
        }
        _ => {}
    }
}

fn parse_curve_definition(line: &str) -> Option<(String, String, String)> {
    let parts: Vec<&str> = line.splitn(2, '.').collect();
    if parts.len() < 2 {
        return None;
    }

    let name = parts[0].trim().to_string();
    let rest = parts[1];

    let mut unit = String::new();
    let mut description = String::new();

    if let Some(space_idx) = rest.find(' ') {
        unit = rest[..space_idx].trim().to_string();
        let desc_part = &rest[space_idx..];
        if let Some(colon_idx) = desc_part.find(':') {
            description = desc_part[colon_idx + 1..].trim().to_string();
        }
    } else if let Some(colon_idx) = rest.find(':') {
        unit = rest[..colon_idx].trim().to_string();
        description = rest[colon_idx + 1..].trim().to_string();
    }

    Some((name, unit, description))
}

fn process_data_section(
    data_lines: &[String],
    curve_info: &[(String, String, String)],
    las_data: &mut LasData,
) -> Result<()> {
    let num_curves = curve_info.len();
    let mut all_values: Vec<Vec<f64>> = vec![Vec::new(); num_curves];

    for line in data_lines {
        let values: Vec<&str> = line.split_whitespace().collect();
        if values.len() != num_curves {
            continue;
        }

        for (i, val) in values.iter().enumerate() {
            if let Ok(v) = val.parse::<f64>() {
                all_values[i].push(v);
            } else {
                all_values[i].push(f64::NAN);
            }
        }
    }

    if !all_values.is_empty() && !all_values[0].is_empty() {
        let depth_array = Array1::from_vec(all_values[0].clone());
        las_data.depth = depth_array;

        for (i, (name, unit, description)) in curve_info.iter().enumerate().skip(1) {
            if i < all_values.len() {
                let data = Array1::from_vec(all_values[i].clone());
                las_data.curves.insert(
                    name.clone(),
                    LasCurve {
                        name: name.clone(),
                        unit: unit.clone(),
                        description: description.clone(),
                        data,
                    },
                );
            }
        }
    }

    Ok(())
}

pub fn create_sample_las_data() -> LasData {
    let n = 500;
    let start = 1000.0;
    let stop = 2000.0;
    let step = (stop - start) / (n - 1) as f64;

    let depth: Vec<f64> = (0..n).map(|i| start + i as f64 * step).collect();

    let mut gr = Vec::with_capacity(n);
    let mut rt = Vec::with_capacity(n);
    let mut dt = Vec::with_capacity(n);

    for i in 0..n {
        let x = i as f64 / n as f64;
        
        let gr_base = 50.0 + 30.0 * (x * 6.0 * std::f64::consts::PI).sin();
        let rt_base = 2.0 + 5.0 * ((x * 4.0 * std::f64::consts::PI).cos()).abs();
        let dt_base = 60.0 + 20.0 * (x * 3.0 * std::f64::consts::PI).sin();

        use rand::Rng;
        let mut rng = rand::thread_rng();
        let noise_amp = 5.0;
        
        gr.push(gr_base + rng.gen_range(-noise_amp..noise_amp));
        rt.push(rt_base + rng.gen_range(-noise_amp * 0.3..noise_amp * 0.3));
        dt.push(dt_base + rng.gen_range(-noise_amp * 0.5..noise_amp * 0.5));
    }

    let mut curves = std::collections::HashMap::new();
    
    curves.insert(
        "GR".to_string(),
        LasCurve {
            name: "GR".to_string(),
            unit: "API".to_string(),
            description: "Gamma Ray".to_string(),
            data: Array1::from_vec(gr),
        },
    );
    
    curves.insert(
        "RT".to_string(),
        LasCurve {
            name: "RT".to_string(),
            unit: "OHMM".to_string(),
            description: "Resistivity".to_string(),
            data: Array1::from_vec(rt),
        },
    );
    
    curves.insert(
        "DT".to_string(),
        LasCurve {
            name: "DT".to_string(),
            unit: "US/F".to_string(),
            description: "Sonic Travel Time".to_string(),
            data: Array1::from_vec(dt),
        },
    );

    LasData {
        well_name: "Sample Well".to_string(),
        well_id: "WELL-001".to_string(),
        depth: Array1::from_vec(depth),
        curves,
        start_depth: start,
        stop_depth: stop,
        step,
    }
}
