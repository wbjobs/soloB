use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LithologyPrediction {
    pub lithology: String,
    pub confidence: f64,
    pub gr_value: f64,
    pub rt_value: f64,
    pub dt_value: f64,
    pub porosity: Option<f64>,
    pub vshale: Option<f64>,
}

pub fn calculate_porosity(dt: f64, dt_matrix: f64, dt_fluid: f64) -> f64 {
    (dt - dt_matrix) / (dt_fluid - dt_matrix)
}

pub fn calculate_vshale(gr: f64, gr_clean: f64, gr_shale: f64) -> f64 {
    if gr_shale - gr_clean == 0.0 {
        return 0.0;
    }
    let vsh = (gr - gr_clean) / (gr_shale - gr_clean);
    vsh.clamp(0.0, 1.0)
}

pub fn predict_lithology_with_metrics(
    gr: f64,
    rt: f64,
    dt: f64,
) -> LithologyPrediction {
    let porosity = calculate_porosity(dt, 55.0, 180.0);
    let vshale = calculate_vshale(gr, 20.0, 100.0);

    let (lithology, confidence) = if gr < 35.0 {
        if rt > 15.0 {
            if dt < 50.0 {
                ("Dolomite", 0.85)
            } else {
                ("Limestone", 0.80)
            }
        } else if dt > 65.0 {
            ("Sandstone", 0.75)
        } else {
            ("Siltstone", 0.65)
        }
    } else if gr > 85.0 {
        if rt > 8.0 && dt > 100.0 {
            ("Coal", 0.90)
        } else {
            ("Shale", 0.85)
        }
    } else {
        if vshale < 0.3 {
            if porosity > 0.15 {
                ("Reservoir Sandstone", 0.70)
            } else {
                ("Tight Sandstone", 0.65)
            }
        } else if vshale < 0.6 {
            ("Shaly Sandstone", 0.70)
        } else {
            ("Sandy Shale", 0.75)
        }
    };

    LithologyPrediction {
        lithology: lithology.to_string(),
        confidence,
        gr_value: gr,
        rt_value: rt,
        dt_value: dt,
        porosity: Some(porosity),
        vshale: Some(vshale),
    }
}

pub fn lithology_color(lithology: &str) -> &'static str {
    match lithology.to_lowercase().as_str() {
        "sandstone" | "reservoir sandstone" | "tight sandstone" => "#f4a460",
        "shale" | "sandy shale" => "#708090",
        "limestone" => "#add8e6",
        "dolomite" => "#dda0dd",
        "coal" => "#2f4f4f",
        "shaly sandstone" => "#deb887",
        "siltstone" => "#cd853f",
        _ => "#808080",
    }
}
