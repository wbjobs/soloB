use crate::{
    correlate_wells, detect_changepoints, export_to_witsml, wavelet_denoise, calculate_snr,
    create_sample_las_data, Formations, LasData, WellCorrelation, LithologyClassifier,
    ClassificationResult, get_lithology_types, get_lithology_color,
};
use axum::{
    extract::{Multipart, State, Json},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use ndarray::Array1;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
pub struct AppState {
    pub wells: Arc<Mutex<HashMap<String, LasData>>>,
    pub classifiers: Arc<Mutex<HashMap<String, LithologyClassifier>>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessRequest {
    pub well_id: String,
    #[serde(default = "default_min_thickness")]
    pub min_thickness: f64,
    #[serde(default = "default_smooth_window")]
    pub smooth_window: usize,
}

fn default_min_thickness() -> f64 { 1.0 }
fn default_smooth_window() -> usize { 11 }

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessResponse {
    pub well_id: String,
    pub well_name: String,
    pub denoised_curves: HashMap<String, Vec<f64>>,
    pub smoothed_curves: HashMap<String, Vec<f64>>,
    pub snr_improvements: HashMap<String, f64>,
    pub formations: Formations,
    pub depth: Vec<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LithologyResponse {
    pub well_id: String,
    pub predictions: Vec<crate::lithology_classifier::LithologyPrediction>,
    pub lithology_types: Vec<String>,
    pub model_info: crate::lithology_classifier::ModelInfo,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddLabelRequest {
    pub well_id: String,
    pub top_depth: f64,
    pub bottom_depth: f64,
    pub lithology: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RetrainRequest {
    pub well_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CorrelationResponse {
    pub correlation: WellCorrelation,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ManualAdjustRequest {
    pub well_id: String,
    pub formation_index: usize,
    pub new_top_depth: Option<f64>,
    pub new_bottom_depth: Option<f64>,
    pub split_depth: Option<f64>,
    pub merge_with_next: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WellInfo {
    pub well_id: String,
    pub well_name: String,
    pub start_depth: f64,
    pub stop_depth: f64,
    pub curves: Vec<String>,
}

async fn get_wells(State(state): State<AppState>) -> Json<Vec<WellInfo>> {
    let wells = state.wells.lock().unwrap();

    let mut result = Vec::new();
    for (well_id, las_data) in wells.iter() {
        result.push(WellInfo {
            well_id: well_id.clone(),
            well_name: las_data.well_name.clone(),
            start_depth: las_data.start_depth,
            stop_depth: las_data.stop_depth,
            curves: las_data.get_curve_names(),
        });
    }

    Json(result)
}

async fn get_lithology_types_handler() -> Json<Vec<String>> {
    Json(get_lithology_types())
}

async fn classify_lithology(
    State(state): State<AppState>,
    Json(request): Json<ProcessRequest>,
) -> Result<Json<LithologyResponse>, StatusCode> {
    let wells = state.wells.lock().unwrap();
    let las_data = wells.get(&request.well_id).ok_or(StatusCode::NOT_FOUND)?;

    let gr = las_data.curves.get("GR").ok_or(StatusCode::BAD_REQUEST)?;
    let rt = las_data.curves.get("RT").ok_or(StatusCode::BAD_REQUEST)?;
    let dt = las_data.curves.get("DT").ok_or(StatusCode::BAD_REQUEST)?;

    let denoised_gr = wavelet_denoise(&gr.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let denoised_rt = wavelet_denoise(&rt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let denoised_dt = wavelet_denoise(&dt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    use crate::smooth::savgol_filter;
    let smoothed_gr = savgol_filter(&denoised_gr, request.smooth_window.max(3), 2);
    let smoothed_rt = savgol_filter(&denoised_rt, request.smooth_window.max(3), 2);
    let smoothed_dt = savgol_filter(&denoised_dt, request.smooth_window.max(3), 2);

    let mut classifiers = state.classifiers.lock().unwrap();
    let classifier = classifiers.entry(request.well_id.clone())
        .or_insert_with(LithologyClassifier::new);

    let predictions = classifier.predict(&smoothed_gr, &smoothed_rt, &smoothed_dt, &las_data.depth);
    let model_info = classifier.get_model_info();

    Ok(Json(LithologyResponse {
        well_id: request.well_id,
        predictions,
        lithology_types: get_lithology_types(),
        model_info,
    }))
}

async fn add_lithology_label(
    State(state): State<AppState>,
    Json(request): Json<AddLabelRequest>,
) -> Result<Json<String>, StatusCode> {
    let wells = state.wells.lock().unwrap();
    wells.get(&request.well_id).ok_or(StatusCode::NOT_FOUND)?;

    let mut classifiers = state.classifiers.lock().unwrap();
    let classifier = classifiers.entry(request.well_id.clone())
        .or_insert_with(LithologyClassifier::new);

    classifier.add_user_label(request.top_depth, request.bottom_depth, request.lithology.clone());

    Ok(Json(format!(
        "Added label: {} - {}m to {}m",
        request.lithology, request.top_depth, request.bottom_depth
    )))
}

async fn retrain_classifier(
    State(state): State<AppState>,
    Json(request): Json<RetrainRequest>,
) -> Result<Json<String>, StatusCode> {
    let wells = state.wells.lock().unwrap();
    let las_data = wells.get(&request.well_id).ok_or(StatusCode::NOT_FOUND)?;

    let gr = las_data.curves.get("GR").ok_or(StatusCode::BAD_REQUEST)?;
    let rt = las_data.curves.get("RT").ok_or(StatusCode::BAD_REQUEST)?;
    let dt = las_data.curves.get("DT").ok_or(StatusCode::BAD_REQUEST)?;

    let denoised_gr = wavelet_denoise(&gr.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let denoised_rt = wavelet_denoise(&rt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let denoised_dt = wavelet_denoise(&dt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    use crate::smooth::savgol_filter;
    let smoothed_gr = savgol_filter(&denoised_gr, 11, 2);
    let smoothed_rt = savgol_filter(&denoised_rt, 11, 2);
    let smoothed_dt = savgol_filter(&denoised_dt, 11, 2);

    let mut classifiers = state.classifiers.lock().unwrap();
    let classifier = classifiers.entry(request.well_id.clone())
        .or_insert_with(LithologyClassifier::new);

    let n_samples = classifier.retrain_with_user_labels(
        &smoothed_gr, &smoothed_rt, &smoothed_dt, &las_data.depth
    );

    Ok(Json(format!(
        "Model retrained with {} new samples from user labels",
        n_samples
    )))
}

async fn process_well(
    State(state): State<AppState>,
    Json(request): Json<ProcessRequest>,
) -> Result<Json<ProcessResponse>, StatusCode> {
    let wells = state.wells.lock().unwrap();
    let las_data = wells.get(&request.well_id).ok_or(StatusCode::NOT_FOUND)?;

    let gr = las_data.curves.get("GR").ok_or(StatusCode::BAD_REQUEST)?;
    let rt = las_data.curves.get("RT").ok_or(StatusCode::BAD_REQUEST)?;
    let dt = las_data.curves.get("DT").ok_or(StatusCode::BAD_REQUEST)?;

    let denoised_gr = wavelet_denoise(&gr.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let denoised_rt = wavelet_denoise(&rt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let denoised_dt = wavelet_denoise(&dt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    use crate::smooth::savgol_filter;
    let smoothed_gr = savgol_filter(&denoised_gr, request.smooth_window.max(3), 2);
    let smoothed_rt = savgol_filter(&denoised_rt, request.smooth_window.max(3), 2);
    let smoothed_dt = savgol_filter(&denoised_dt, request.smooth_window.max(3), 2);

    let snr_gr = calculate_snr(&gr.data, &denoised_gr);
    let snr_rt = calculate_snr(&rt.data, &denoised_rt);
    let snr_dt = calculate_snr(&dt.data, &denoised_dt);

    let mut snr_improvements = HashMap::new();
    snr_improvements.insert("GR".to_string(), snr_gr);
    snr_improvements.insert("RT".to_string(), snr_rt);
    snr_improvements.insert("DT".to_string(), snr_dt);

    let formations = detect_changepoints(
        &las_data.depth,
        &smoothed_gr,
        &smoothed_rt,
        &smoothed_dt,
        Some(request.min_thickness),
        Some(request.smooth_window),
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut denoised_curves = HashMap::new();
    denoised_curves.insert("GR".to_string(), denoised_gr.to_vec());
    denoised_curves.insert("RT".to_string(), denoised_rt.to_vec());
    denoised_curves.insert("DT".to_string(), denoised_dt.to_vec());

    let mut smoothed_curves = HashMap::new();
    smoothed_curves.insert("GR".to_string(), smoothed_gr.to_vec());
    smoothed_curves.insert("RT".to_string(), smoothed_rt.to_vec());
    smoothed_curves.insert("DT".to_string(), smoothed_dt.to_vec());

    Ok(Json(ProcessResponse {
        well_id: request.well_id,
        well_name: las_data.well_name.clone(),
        denoised_curves,
        smoothed_curves,
        snr_improvements,
        formations,
        depth: las_data.depth.to_vec(),
    }))
}

async fn manual_adjust(
    State(state): State<AppState>,
    Json(request): Json<ManualAdjustRequest>,
) -> Result<Json<ProcessResponse>, StatusCode> {
    let wells = state.wells.lock().unwrap();
    let las_data = wells.get(&request.well_id).ok_or(StatusCode::NOT_FOUND)?;

    let gr = las_data.curves.get("GR").ok_or(StatusCode::BAD_REQUEST)?;
    let rt = las_data.curves.get("RT").ok_or(StatusCode::BAD_REQUEST)?;
    let dt = las_data.curves.get("DT").ok_or(StatusCode::BAD_REQUEST)?;

    let denoised_gr = wavelet_denoise(&gr.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let denoised_rt = wavelet_denoise(&rt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let denoised_dt = wavelet_denoise(&dt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    use crate::smooth::savgol_filter;
    let smoothed_gr = savgol_filter(&denoised_gr, 11, 2);
    let smoothed_rt = savgol_filter(&denoised_rt, 11, 2);
    let smoothed_dt = savgol_filter(&denoised_dt, 11, 2);

    let mut formations = detect_changepoints(
        &las_data.depth,
        &smoothed_gr,
        &smoothed_rt,
        &smoothed_dt,
        Some(1.0),
        Some(11),
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(split_depth) = request.split_depth {
        if request.formation_index < formations.formations.len() {
            let f = &formations.formations[request.formation_index];
            if split_depth > f.top_depth && split_depth < f.bottom_depth {
                let mut new_formation = f.clone();
                formations.formations[request.formation_index].bottom_depth = split_depth;
                formations.formations[request.formation_index].thickness =
                    split_depth - formations.formations[request.formation_index].top_depth;
                new_formation.top_depth = split_depth;
                new_formation.thickness = f.bottom_depth - split_depth;
                new_formation.name = format!("Formation_{}_split", formations.formations.len() + 1);
                formations.formations.insert(request.formation_index + 1, new_formation);
            }
        }
    }

    if let Some(true) = request.merge_with_next {
        if request.formation_index < formations.formations.len() - 1 {
            let f1 = formations.formations[request.formation_index].clone();
            let f2 = formations.formations[request.formation_index + 1].clone();

            let start_idx = las_data.depth
                .iter()
                .position(|&d| d >= f1.top_depth)
                .unwrap_or(0);
            let end_idx = las_data.depth
                .iter()
                .rposition(|&d| d <= f2.bottom_depth)
                .unwrap_or(las_data.depth.len() - 1);

            let gr_slice = gr.data.slice(s![start_idx..=end_idx]);
            let rt_slice = rt.data.slice(s![start_idx..=end_idx]);
            let dt_slice = dt.data.slice(s![start_idx..=end_idx]);

            let gr_mean = gr_slice.mean().unwrap_or(0.0);
            let rt_mean = rt_slice.mean().unwrap_or(0.0);
            let dt_mean = dt_slice.mean().unwrap_or(0.0);

            let lithology = if gr_mean < 40.0 {
                if rt_mean > 10.0 { "Limestone" } else { "Sandstone" }
            } else if gr_mean > 80.0 {
                "Shale"
            } else {
                "Shaly Sand"
            };

            formations.formations[request.formation_index] = crate::pelt::Formation {
                name: f1.name,
                top_depth: f1.top_depth,
                bottom_depth: f2.bottom_depth,
                lithology: lithology.to_string(),
                gr_mean,
                rt_mean,
                dt_mean,
                thickness: f2.bottom_depth - f1.top_depth,
            };
            formations.formations.remove(request.formation_index + 1);
        }
    }

    if let Some(new_top) = request.new_top_depth {
        if request.formation_index < formations.formations.len() {
            formations.formations[request.formation_index].top_depth = new_top;
            formations.formations[request.formation_index].thickness =
                formations.formations[request.formation_index].bottom_depth - new_top;
        }
    }

    if let Some(new_bottom) = request.new_bottom_depth {
        if request.formation_index < formations.formations.len() {
            formations.formations[request.formation_index].bottom_depth = new_bottom;
            formations.formations[request.formation_index].thickness =
                new_bottom - formations.formations[request.formation_index].top_depth;
        }
    }

    for (idx, f) in formations.formations.iter_mut().enumerate() {
        f.name = format!("Formation_{}", idx + 1);
    }

    let snr_gr = calculate_snr(&gr.data, &denoised_gr);
    let snr_rt = calculate_snr(&rt.data, &denoised_rt);
    let snr_dt = calculate_snr(&dt.data, &denoised_dt);

    let mut snr_improvements = HashMap::new();
    snr_improvements.insert("GR".to_string(), snr_gr);
    snr_improvements.insert("RT".to_string(), snr_rt);
    snr_improvements.insert("DT".to_string(), snr_dt);

    let mut denoised_curves = HashMap::new();
    denoised_curves.insert("GR".to_string(), denoised_gr.to_vec());
    denoised_curves.insert("RT".to_string(), denoised_rt.to_vec());
    denoised_curves.insert("DT".to_string(), denoised_dt.to_vec());

    let mut smoothed_curves = HashMap::new();
    smoothed_curves.insert("GR".to_string(), smoothed_gr.to_vec());
    smoothed_curves.insert("RT".to_string(), smoothed_rt.to_vec());
    smoothed_curves.insert("DT".to_string(), smoothed_dt.to_vec());

    Ok(Json(ProcessResponse {
        well_id: request.well_id,
        well_name: las_data.well_name.clone(),
        denoised_curves,
        smoothed_curves,
        snr_improvements,
        formations,
        depth: las_data.depth.to_vec(),
    }))
}

async fn correlate_all_wells(
    State(state): State<AppState>,
) -> Result<Json<CorrelationResponse>, StatusCode> {
    let wells = state.wells.lock().unwrap();

    if wells.is_empty() {
        return Ok(Json(CorrelationResponse {
            correlation: WellCorrelation {
                field_name: "Field".to_string(),
                wells: Vec::new(),
                correlated_formations: Vec::new(),
                correlation_matrix: Vec::new(),
            },
        }));
    }

    let mut well_data = Vec::new();

    for (well_id, las_data) in wells.iter() {
        let gr = las_data.curves.get("GR").ok_or(StatusCode::BAD_REQUEST)?;
        let rt = las_data.curves.get("RT").ok_or(StatusCode::BAD_REQUEST)?;
        let dt = las_data.curves.get("DT").ok_or(StatusCode::BAD_REQUEST)?;

        let denoised_gr = wavelet_denoise(&gr.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let denoised_rt = wavelet_denoise(&rt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let denoised_dt = wavelet_denoise(&dt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        use crate::smooth::savgol_filter;
        let smoothed_gr = savgol_filter(&denoised_gr, 11, 2);
        let smoothed_rt = savgol_filter(&denoised_rt, 11, 2);
        let smoothed_dt = savgol_filter(&denoised_dt, 11, 2);

        let formations = detect_changepoints(
            &las_data.depth,
            &smoothed_gr,
            &smoothed_rt,
            &smoothed_dt,
            Some(1.0),
            Some(11),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        well_data.push((
            las_data.well_name.clone(),
            formations,
            las_data.depth.clone(),
            smoothed_gr,
            smoothed_rt,
            smoothed_dt,
        ));
    }

    let correlation = correlate_wells(&well_data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(CorrelationResponse { correlation }))
}

async fn export_witsml(
    State(state): State<AppState>,
    Json(request): Json<ProcessRequest>,
) -> Result<(HeaderMap, String), StatusCode> {
    let wells = state.wells.lock().unwrap();
    let las_data = wells.get(&request.well_id).ok_or(StatusCode::NOT_FOUND)?;

    let gr = las_data.curves.get("GR").ok_or(StatusCode::BAD_REQUEST)?;
    let rt = las_data.curves.get("RT").ok_or(StatusCode::BAD_REQUEST)?;
    let dt = las_data.curves.get("DT").ok_or(StatusCode::BAD_REQUEST)?;

    let denoised_gr = wavelet_denoise(&gr.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let denoised_rt = wavelet_denoise(&rt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let denoised_dt = wavelet_denoise(&dt.data, None).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    use crate::smooth::savgol_filter;
    let smoothed_gr = savgol_filter(&denoised_gr, 11, 2);
    let smoothed_rt = savgol_filter(&denoised_rt, 11, 2);
    let smoothed_dt = savgol_filter(&denoised_dt, 11, 2);

    let formations = detect_changepoints(
        &las_data.depth,
        &smoothed_gr,
        &smoothed_rt,
        &smoothed_dt,
        Some(request.min_thickness),
        Some(request.smooth_window),
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let witsml_xml = export_to_witsml(
        &las_data.well_name,
        &request.well_id,
        las_data,
        &formations,
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::CONTENT_TYPE,
        "application/xml".parse().unwrap(),
    );
    headers.insert(
        axum::http::header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}.xml\"", request.well_id)
            .parse()
            .unwrap(),
    );

    Ok((headers, witsml_xml))
}

async fn upload_las(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<WellInfo>, StatusCode> {
    while let Some(field) = multipart.next_field().await.map_err(|_| StatusCode::BAD_REQUEST)? {
        if field.name() == Some("file") {
            let data = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;
            let content = String::from_utf8(data.to_vec()).map_err(|_| StatusCode::BAD_REQUEST)?;

            let mut wells = state.wells.lock().unwrap();
            let well_id = format!("WELL_{}", wells.len() + 1);

            let mut las_data = create_sample_las_data();
            las_data.well_id = well_id.clone();
            las_data.well_name = format!("Well {}", wells.len() + 1);

            wells.insert(well_id.clone(), las_data.clone());

            return Ok(Json(WellInfo {
                well_id,
                well_name: las_data.well_name,
                start_depth: las_data.start_depth,
                stop_depth: las_data.stop_depth,
                curves: las_data.get_curve_names(),
            }));
        }
    }

    Err(StatusCode::BAD_REQUEST)
}

async fn add_sample_well(State(state): State<AppState>) -> Json<WellInfo> {
    let mut wells = state.wells.lock().unwrap();
    let well_id = format!("WELL_{}", wells.len() + 1);

    let mut las_data = create_sample_las_data();
    las_data.well_id = well_id.clone();
    las_data.well_name = format!("Sample Well {}", wells.len() + 1);

    wells.insert(well_id.clone(), las_data.clone());

    Json(WellInfo {
        well_id,
        well_name: las_data.well_name,
        start_depth: las_data.start_depth,
        stop_depth: las_data.stop_depth,
        curves: las_data.get_curve_names(),
    })
}

pub fn create_router() -> Router {
    let mut wells = HashMap::new();
    let sample1 = create_sample_las_data();
    wells.insert("WELL_1".to_string(), sample1);

    let classifiers = HashMap::new();

    let state = AppState {
        wells: Arc::new(Mutex::new(wells)),
        classifiers: Arc::new(Mutex::new(classifiers)),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/api/wells", get(get_wells))
        .route("/api/wells/sample", post(add_sample_well))
        .route("/api/wells/upload", post(upload_las))
        .route("/api/process", post(process_well))
        .route("/api/adjust", post(manual_adjust))
        .route("/api/correlate", get(correlate_all_wells))
        .route("/api/export/witsml", post(export_witsml))
        .route("/api/lithology/types", get(get_lithology_types_handler))
        .route("/api/lithology/classify", post(classify_lithology))
        .route("/api/lithology/label", post(add_lithology_label))
        .route("/api/lithology/retrain", post(retrain_classifier))
        .with_state(state)
        .layer(cors)
}
