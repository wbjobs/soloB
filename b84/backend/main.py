from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Tuple, Dict, Any
import numpy as np
from pykrige.ok import OrdinaryKriging
from scipy.spatial import Delaunay, cKDTree
from scipy.interpolate import griddata
import trimesh
from shapely.geometry import Polygon, Point
import json
import io
import base64
import random
import math

app = FastAPI(title="地质体三维建模API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class BoreholeLayer(BaseModel):
    depth: float
    lithology: str
    elevation: float

class BoreholeData(BaseModel):
    id: str
    longitude: float
    latitude: float
    x: float
    y: float
    surface_elevation: float
    layers: List[BoreholeLayer]

class InterpolationRequest(BaseModel):
    boreholes: List[BoreholeData]
    stratigraphic_index: int
    method: str = "kriging"
    grid_size: float = 10.0
    power: Optional[float] = 2.0
    variogram_model: Optional[str] = "spherical"
    lod_level: Optional[int] = 0

class ChunkRequest(BaseModel):
    boreholes: List[BoreholeData]
    stratigraphic_index: int
    method: str = "kriging"
    grid_size: float = 10.0
    chunk_index: Tuple[int, int] = (0, 0)
    chunk_size: float = 200.0
    lod_level: int = 0

class SectionRequest(BaseModel):
    boreholes: List[BoreholeData]
    start_point: Tuple[float, float]
    end_point: Tuple[float, float]
    width: float = 5.0

class VolumeCalculationRequest(BaseModel):
    mesh_vertices: List[List[float]]
    mesh_faces: List[List[int]]
    ore_lithology: str
    boundary_polygon: Optional[List[Tuple[float, float]]] = None

class ExportGLTFRequest(BaseModel):
    surfaces: List[dict]
    boreholes: List[BoreholeData]

class VirtualDrillingRequest(BaseModel):
    boreholes: List[BoreholeData]
    point_x: float
    point_y: float
    method: str = "kriging"
    max_depth: Optional[float] = 500.0

class LithologyPrediction(BaseModel):
    depth_from: float
    depth_to: float
    elevation_from: float
    elevation_to: float
    lithology: str
    confidence: float
    thickness: float

class DrillingResponse(BaseModel):
    point_x: float
    point_y: float
    surface_elevation: float
    stratigraphy: List[LithologyPrediction]
    overall_confidence: float
    nearest_borehole_distance: float
    nearest_borehole_id: str
    kriging_variance: Optional[float]

def inverse_distance_weighting(points, values, grid_x, grid_y, power=2):
    xi, yi = np.meshgrid(grid_x, grid_y)
    zi = np.zeros_like(xi)
    
    for i in range(len(grid_x)):
        for j in range(len(grid_y)):
            distances = np.sqrt((points[:, 0] - grid_x[i])**2 + (points[:, 1] - grid_y[j])**2)
            distances[distances == 0] = 1e-10
            weights = 1.0 / (distances ** power)
            zi[j, i] = np.sum(weights * values) / np.sum(weights)
    
    return xi, yi, zi

def kriging_interpolation(points, values, grid_x, grid_y, variogram_model="spherical"):
    OK = OrdinaryKriging(
        points[:, 0], points[:, 1], values,
        variogram_model=variogram_model,
        verbose=False,
        enable_plotting=False
    )
    zi, _ = OK.execute("grid", grid_x, grid_y)
    xi, yi = np.meshgrid(grid_x, grid_y)
    return xi, yi, zi

def simplify_mesh_quadric(vertices, faces, target_ratio=0.5):
    if len(faces) < 100:
        return vertices, faces
    
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
    simplified = mesh.simplify_quadric_decimation(int(len(faces) * target_ratio))
    return simplified.vertices.tolist(), simplified.faces.tolist()

def simplify_mesh_clustering(vertices, faces, grid_size=5.0):
    vertices = np.array(vertices)
    faces = np.array(faces)
    
    rounded = np.round(vertices / grid_size) * grid_size
    
    unique_verts, inverse = np.unique(rounded, axis=0, return_inverse=True)
    
    new_faces = inverse[faces]
    
    valid_faces = []
    for face in new_faces:
        if len(np.unique(face)) == 3:
            valid_faces.append(face.tolist())
    
    return unique_verts.tolist(), valid_faces

def generate_lod_levels(vertices, faces, num_levels=4):
    lod_levels = []
    ratios = [1.0, 0.5, 0.25, 0.1]
    
    for i, ratio in enumerate(ratios[:num_levels]):
        if i == 0:
            lod_verts, lod_faces = vertices, faces
        else:
            lod_verts, lod_faces = simplify_mesh_quadric(vertices, faces, ratio)
        
        lod_levels.append({
            "level": i,
            "ratio": ratio,
            "vertices": lod_verts,
            "faces": lod_faces,
            "vertex_count": len(lod_verts),
            "face_count": len(lod_faces)
        })
    
    return lod_levels

def calculate_chunk_bounds(boreholes, chunk_index, chunk_size, padding=20):
    x_coords = [bh.x for bh in boreholes]
    y_coords = [bh.y for bh in boreholes]
    
    global_min_x, global_max_x = min(x_coords) - padding, max(x_coords) + padding
    global_min_y, global_max_y = min(y_coords) - padding, max(y_coords) + padding
    
    num_chunks_x = math.ceil((global_max_x - global_min_x) / chunk_size)
    num_chunks_y = math.ceil((global_max_y - global_min_y) / chunk_size)
    
    chunk_i, chunk_j = chunk_index
    
    if chunk_i >= num_chunks_x or chunk_j >= num_chunks_y:
        return None
    
    chunk_min_x = global_min_x + chunk_i * chunk_size
    chunk_max_x = min(chunk_min_x + chunk_size, global_max_x)
    chunk_min_y = global_min_y + chunk_j * chunk_size
    chunk_max_y = min(chunk_min_y + chunk_size, global_max_y)
    
    return {
        "min_x": chunk_min_x,
        "max_x": chunk_max_x,
        "min_y": chunk_min_y,
        "max_y": chunk_max_y,
        "center": [(chunk_min_x + chunk_max_x) / 2, (chunk_min_y + chunk_max_y) / 2],
        "num_chunks": (num_chunks_x, num_chunks_y),
        "global_bounds": (global_min_x, global_max_x, global_min_y, global_max_y)
    }

@app.post("/api/interpolate")
async def interpolate_surface(request: InterpolationRequest):
    try:
        points = []
        values = []
        
        for bh in request.boreholes:
            if len(bh.layers) > request.stratigraphic_index:
                layer = bh.layers[request.stratigraphic_index]
                points.append([bh.x, bh.y])
                values.append(layer.elevation)
        
        points = np.array(points)
        values = np.array(values)
        
        if len(points) < 3:
            raise HTTPException(status_code=400, detail="至少需要3个钻孔数据")
        
        x_min, x_max = points[:, 0].min(), points[:, 0].max()
        y_min, y_max = points[:, 1].min(), points[:, 1].max()
        
        grid_size = request.grid_size
        if request.lod_level > 0:
            grid_size *= (2 ** request.lod_level)
        
        grid_x = np.arange(x_min - grid_size * 2, x_max + grid_size * 2, grid_size)
        grid_y = np.arange(y_min - grid_size * 2, y_max + grid_size * 2, grid_size)
        
        if request.method == "kriging":
            xi, yi, zi = kriging_interpolation(points, values, grid_x, grid_y, request.variogram_model)
        elif request.method == "idw":
            xi, yi, zi = inverse_distance_weighting(points, values, grid_x, grid_y, request.power)
        else:
            raise HTTPException(status_code=400, detail="不支持的插值方法")
        
        tri = Delaunay(np.column_stack((xi.flatten(), yi.flatten())))
        
        vertices = []
        for i in range(len(xi.flatten())):
            vertices.append([float(xi.flatten()[i]), float(yi.flatten()[i]), float(zi.flatten()[i])])
        
        faces = tri.simplices.tolist()
        
        return {
            "vertices": vertices,
            "faces": faces,
            "grid_x": grid_x.tolist(),
            "grid_y": grid_y.tolist(),
            "z_values": zi.tolist(),
            "lod_level": request.lod_level,
            "vertex_count": len(vertices),
            "face_count": len(faces)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chunk/interpolate")
async def interpolate_chunk(request: ChunkRequest):
    try:
        bounds = calculate_chunk_bounds(request.boreholes, request.chunk_index, request.chunk_size)
        
        if bounds is None:
            return {
                "chunk_index": request.chunk_index,
                "vertices": [],
                "faces": [],
                "bounds": None,
                "isEmpty": True
            }
        
        points = []
        values = []
        
        for bh in request.boreholes:
            if len(bh.layers) > request.stratigraphic_index:
                layer = bh.layers[request.stratigraphic_index]
                if (bounds["min_x"] - 50 <= bh.x <= bounds["max_x"] + 50 and 
                    bounds["min_y"] - 50 <= bh.y <= bounds["max_y"] + 50):
                    points.append([bh.x, bh.y])
                    values.append(layer.elevation)
        
        if len(points) < 3:
            return {
                "chunk_index": request.chunk_index,
                "vertices": [],
                "faces": [],
                "bounds": bounds,
                "isEmpty": True
            }
        
        points = np.array(points)
        values = np.array(values)
        
        grid_size = request.grid_size
        if request.lod_level > 0:
            grid_size *= (2 ** request.lod_level)
        
        grid_x = np.arange(bounds["min_x"], bounds["max_x"] + grid_size, grid_size)
        grid_y = np.arange(bounds["min_y"], bounds["max_y"] + grid_size, grid_size)
        
        if request.method == "kriging":
            xi, yi, zi = kriging_interpolation(points, values, grid_x, grid_y)
        elif request.method == "idw":
            xi, yi, zi = inverse_distance_weighting(points, values, grid_x, grid_y)
        else:
            raise HTTPException(status_code=400, detail="不支持的插值方法")
        
        tri = Delaunay(np.column_stack((xi.flatten(), yi.flatten())))
        
        vertices = []
        for i in range(len(xi.flatten())):
            vertices.append([float(xi.flatten()[i]), float(yi.flatten()[i]), float(zi.flatten()[i])])
        
        faces = tri.simplices.tolist()
        
        return {
            "chunk_index": request.chunk_index,
            "vertices": vertices,
            "faces": faces,
            "bounds": bounds,
            "isEmpty": False,
            "lod_level": request.lod_level,
            "vertex_count": len(vertices),
            "face_count": len(faces)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/interpolate/lod")
async def interpolate_with_lod(request: InterpolationRequest):
    try:
        base_result = await interpolate_surface(request)
        
        lod_levels = generate_lod_levels(
            base_result["vertices"], 
            base_result["faces"],
            num_levels=4
        )
        
        return {
            "lod_levels": lod_levels,
            "grid_x": base_result["grid_x"],
            "grid_y": base_result["grid_y"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/stream/interpolate")
async def stream_interpolate(request: InterpolationRequest):
    async def generate():
        points = []
        values = []
        
        for bh in request.boreholes:
            if len(bh.layers) > request.stratigraphic_index:
                layer = bh.layers[request.stratigraphic_index]
                points.append([bh.x, bh.y])
                values.append(layer.elevation)
        
        points = np.array(points)
        values = np.array(values)
        
        if len(points) < 3:
            yield json.dumps({"error": "至少需要3个钻孔数据"})
            return
        
        x_min, x_max = points[:, 0].min(), points[:, 0].max()
        y_min, y_max = points[:, 1].min(), points[:, 1].max()
        
        chunk_size = 200.0
        num_chunks_x = math.ceil((x_max - x_min) / chunk_size)
        num_chunks_y = math.ceil((y_max - y_min) / chunk_size)
        total_chunks = num_chunks_x * num_chunks_y
        
        yield json.dumps({
            "type": "metadata",
            "total_chunks": total_chunks,
            "bounds": [float(x_min), float(x_max), float(y_min), float(y_max)],
            "num_chunks": (num_chunks_x, num_chunks_y)
        }) + "\n"
        
        chunk_count = 0
        for i in range(num_chunks_x):
            for j in range(num_chunks_y):
                chunk_min_x = x_min + i * chunk_size
                chunk_max_x = min(chunk_min_x + chunk_size, x_max)
                chunk_min_y = y_min + j * chunk_size
                chunk_max_y = min(chunk_min_y + chunk_size, y_max)
                
                grid_x = np.arange(chunk_min_x, chunk_max_x + request.grid_size, request.grid_size)
                grid_y = np.arange(chunk_min_y, chunk_max_y + request.grid_size, request.grid_size)
                
                if len(grid_x) > 1 and len(grid_y) > 1:
                    if request.method == "kriging":
                        xi, yi, zi = kriging_interpolation(points, values, grid_x, grid_y)
                    else:
                        xi, yi, zi = inverse_distance_weighting(points, values, grid_x, grid_y)
                    
                    tri = Delaunay(np.column_stack((xi.flatten(), yi.flatten())))
                    
                    vertices = []
                    for k in range(len(xi.flatten())):
                        vertices.append([float(xi.flatten()[k]), float(yi.flatten()[k]), float(zi.flatten()[k])])
                    
                    faces = tri.simplices.tolist()
                    
                    yield json.dumps({
                        "type": "chunk",
                        "chunk_index": (i, j),
                        "vertices": vertices,
                        "faces": faces,
                        "bounds": [float(chunk_min_x), float(chunk_max_x), float(chunk_min_y), float(chunk_max_y)],
                        "progress": float((chunk_count + 1) / total_chunks)
                    }) + "\n"
                
                chunk_count += 1
        
        yield json.dumps({"type": "complete"}) + "\n"
    
    return StreamingResponse(generate(), media_type="application/x-ndjson")

@app.post("/api/boreholes/chunk")
async def get_boreholes_chunk(boreholes: List[BoreholeData], chunk_index: Tuple[int, int] = (0, 0), chunk_size: float = 200.0):
    try:
        x_coords = [bh.x for bh in boreholes]
        y_coords = [bh.y for bh in boreholes]
        
        global_min_x, global_max_x = min(x_coords), max(x_coords)
        global_min_y, global_max_y = min(y_coords), max(y_coords)
        
        chunk_i, chunk_j = chunk_index
        chunk_min_x = global_min_x + chunk_i * chunk_size
        chunk_max_x = chunk_min_x + chunk_size
        chunk_min_y = global_min_y + chunk_j * chunk_size
        chunk_max_y = chunk_min_y + chunk_size
        
        chunk_boreholes = []
        for bh in boreholes:
            if chunk_min_x <= bh.x <= chunk_max_x and chunk_min_y <= bh.y <= chunk_max_y:
                chunk_boreholes.append(bh)
        
        return {
            "chunk_index": chunk_index,
            "boreholes": chunk_boreholes,
            "bounds": [chunk_min_x, chunk_max_x, chunk_min_y, chunk_max_y],
            "count": len(chunk_boreholes)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/section")
async def generate_section(request: SectionRequest):
    try:
        start = np.array(request.start_point)
        end = np.array(request.end_point)
        direction = end - start
        length = np.linalg.norm(direction)
        direction = direction / length
        
        section_data = []
        
        for bh in request.boreholes:
            bh_point = np.array([bh.x, bh.y])
            to_point = bh_point - start
            proj_length = np.dot(to_point, direction)
            
            if 0 <= proj_length <= length:
                perp_dist = np.linalg.norm(to_point - proj_length * direction)
                if perp_dist <= request.width:
                    section_data.append({
                        "borehole_id": bh.id,
                        "distance": float(proj_length),
                        "surface_elevation": bh.surface_elevation,
                        "layers": [
                            {
                                "depth": layer.depth,
                                "elevation": layer.elevation,
                                "lithology": layer.lithology
                            }
                            for layer in bh.layers
                        ]
                    })
        
        section_data.sort(key=lambda x: x["distance"])
        
        return {
            "start_point": request.start_point,
            "end_point": request.end_point,
            "length": float(length),
            "boreholes": section_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/calculate-volume")
async def calculate_volume(request: VolumeCalculationRequest):
    try:
        vertices = np.array(request.mesh_vertices)
        faces = np.array(request.mesh_faces)
        
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
        
        if request.boundary_polygon and len(request.boundary_polygon) >= 3:
            boundary = Polygon(request.boundary_polygon)
            centers = mesh.triangles_center[:, :2]
            mask = np.array([boundary.contains(Point(c)) for c in centers])
            mesh.update_faces(mask)
        
        volume = mesh.volume
        
        return {
            "volume": float(abs(volume)),
            "unit": "cubic meters",
            "mesh_area": float(mesh.area)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/export-gltf")
async def export_gltf(request: ExportGLTFRequest):
    try:
        from trimesh.exchange.gltf import export_glb
        
        scene = trimesh.Scene()
        
        for i, surface in enumerate(request.surfaces):
            vertices = np.array(surface["vertices"])
            faces = np.array(surface["faces"])
            color = surface.get("color", [random.randint(0, 255) for _ in range(3)])
            
            mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
            mesh.visual.vertex_colors = np.tile(color, (len(vertices), 1))
            scene.add_geometry(mesh, node_name=f"surface_{i}")
        
        for bh in request.boreholes:
            cylinder_segments = []
            prev_elev = bh.surface_elevation
            for layer in bh.layers:
                height = prev_elev - layer.elevation
                if height > 0:
                    cyl = trimesh.creation.cylinder(radius=2, height=height, sections=8)
                    cyl.apply_translation([bh.x, bh.y, layer.elevation + height / 2])
                    cylinder_segments.append(cyl)
                    prev_elev = layer.elevation
            
            if cylinder_segments:
                bh_mesh = trimesh.util.concatenate(cylinder_segments)
                scene.add_geometry(bh_mesh, node_name=f"borehole_{bh.id}")
        
        glb_data = export_glb(scene)
        glb_base64 = base64.b64encode(glb_data).decode('utf-8')
        
        return {
            "gltf_data": glb_base64,
            "format": "glb"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sample-boreholes")
async def get_sample_boreholes(count: int = 50):
    boreholes = []
    lithologies = ["花岗岩", "片麻岩", "石英岩", "大理岩", "矽卡岩", "矿体"]
    
    for i in range(count):
        x = 100 + (i % 10) * 50 + random.uniform(-20, 20)
        y = 100 + (i // 10) * 50 + random.uniform(-15, 15)
        surface_elev = 150 + random.uniform(-10, 10)
        
        layers = []
        current_elev = surface_elev
        
        for j in range(4):
            depth = 20 + random.uniform(5, 15)
            current_elev -= depth
            lithology = lithologies[min(j, len(lithologies) - 1)]
            layers.append({
                "depth": float(surface_elev - current_elev),
                "elevation": float(current_elev),
                "lithology": lithology
            })
        
        boreholes.append({
            "id": f"BH-{i+1:04d}",
            "longitude": 116.0 + x / 1000,
            "latitude": 39.0 + y / 1000,
            "x": float(x),
            "y": float(y),
            "surface_elevation": float(surface_elev),
            "layers": layers
        })
    
    return boreholes

@app.get("/api/chunk/info")
async def get_chunk_info(boreholes: List[BoreholeData], chunk_size: float = 200.0):
    x_coords = [bh.x for bh in boreholes]
    y_coords = [bh.y for bh in boreholes]
    
    min_x, max_x = min(x_coords), max(x_coords)
    min_y, max_y = min(y_coords), max(y_coords)
    
    num_chunks_x = math.ceil((max_x - min_x) / chunk_size)
    num_chunks_y = math.ceil((max_y - min_y) / chunk_size)
    
    return {
        "global_bounds": [float(min_x), float(max_x), float(min_y), float(max_y)],
        "chunk_size": chunk_size,
        "num_chunks": (num_chunks_x, num_chunks_y),
        "total_chunks": num_chunks_x * num_chunks_y
    }

def predict_point_kriging(points, values, x, y, variogram_model="spherical"):
    OK = OrdinaryKriging(
        points[:, 0], points[:, 1], values,
        variogram_model=variogram_model,
        verbose=False,
        enable_plotting=False
    )
    z, ss = OK.execute("grid", [x], [y])
    return float(z[0][0]), float(ss[0][0])

def predict_point_idw(points, values, x, y, power=2):
    distances = np.sqrt((points[:, 0] - x)**2 + (points[:, 1] - y)**2)
    distances[distances == 0] = 1e-10
    weights = 1.0 / (distances ** power)
    z = np.sum(weights * values) / np.sum(weights)
    variance = np.sum(weights * (values - z)**2) / np.sum(weights)
    return float(z), float(variance)

def calculate_confidence(distance, kriging_variance, num_boreholes, max_distance=500.0):
    distance_score = max(0, 1 - distance / max_distance)
    variance_score = 1 / (1 + kriging_variance * 10) if kriging_variance > 0 else 1.0
    borehole_density_score = min(1, num_boreholes / 8)
    confidence = (0.4 * distance_score + 0.4 * variance_score + 0.2 * borehole_density_score) * 100
    return min(100, max(0, confidence))

def find_nearest_boreholes(boreholes, x, y, k=5):
    points = np.array([[bh.x, bh.y] for bh in boreholes])
    tree = cKDTree(points)
    distances, indices = tree.query([x, y], k=min(k, len(boreholes)))
    if len(indices.shape) == 0:
        indices = [indices]
        distances = [distances]
    results = []
    for dist, idx in zip(distances, indices):
        results.append({"borehole": boreholes[idx], "distance": float(dist)})
    return results

def predict_stratigraphy_at_point(boreholes, x, y, method="kriging"):
    max_layers = max(len(bh.layers) for bh in boreholes) if boreholes else 0
    if max_layers == 0:
        return None
    
    nearest = find_nearest_boreholes(boreholes, x, y, k=1)
    nearest_bh = nearest[0]["borehole"]
    nearest_dist = nearest[0]["distance"]
    
    surface_elevations = np.array([bh.surface_elevation for bh in boreholes])
    points_2d = np.array([[bh.x, bh.y] for bh in boreholes])
    
    if method == "kriging":
        pred_surface_elev, surf_variance = predict_point_kriging(points_2d, surface_elevations, x, y)
    else:
        pred_surface_elev, surf_variance = predict_point_idw(points_2d, surface_elevations, x, y)
    
    stratigraphy = []
    current_elev = pred_surface_elev
    total_variance = surf_variance
    
    for layer_idx in range(max_layers):
        valid_boreholes = []
        valid_elevations = []
        
        for bh in boreholes:
            if len(bh.layers) > layer_idx:
                valid_boreholes.append(bh)
                valid_elevations.append(bh.layers[layer_idx].elevation)
        
        if len(valid_boreholes) < 3:
            break
        
        valid_points = np.array([[bh.x, bh.y] for bh in valid_boreholes])
        valid_elevations = np.array(valid_elevations)
        
        if method == "kriging":
            pred_elev, variance = predict_point_kriging(valid_points, valid_elevations, x, y)
        else:
            pred_elev, variance = predict_point_idw(valid_points, valid_elevations, x, y)
        
        total_variance += variance
        
        nearest_k = find_nearest_boreholes(valid_boreholes, x, y, k=5)
        lithology_weights = {}
        for nb in nearest_k:
            if len(nb["borehole"].layers) > layer_idx:
                lith = nb["borehole"].layers[layer_idx].lithology
                weight = 1 / (1 + nb["distance"] / 50)
                if lith in lithology_weights:
                    lithology_weights[lith] += weight
                else:
                    lithology_weights[lith] = weight
        
        if lithology_weights:
            best_lith = max(lithology_weights.items(), key=lambda x: x[1])[0]
            total_weight = sum(lithology_weights.values())
            lith_confidence = (lithology_weights[best_lith] / total_weight) * 100
        else:
            best_lith = "未知"
            lith_confidence = 0
        
        dist_confidence = calculate_confidence(nearest_dist, total_variance / (layer_idx + 1), len(valid_boreholes))
        final_confidence = 0.7 * lith_confidence + 0.3 * dist_confidence
        
        thickness = current_elev - pred_elev
        if thickness > 0:
            stratigraphy.append({
                "depth_from": pred_surface_elev - current_elev,
                "depth_to": pred_surface_elev - pred_elev,
                "elevation_from": current_elev,
                "elevation_to": pred_elev,
                "lithology": best_lith,
                "confidence": final_confidence,
                "thickness": thickness
            })
        
        current_elev = pred_elev
    
    return {
        "point_x": x,
        "point_y": y,
        "surface_elevation": pred_surface_elev,
        "stratigraphy": stratigraphy,
        "overall_confidence": calculate_confidence(nearest_dist, total_variance / max(1, len(stratigraphy)), len(boreholes)),
        "nearest_borehole_distance": nearest_dist,
        "nearest_borehole_id": nearest_bh.id,
        "kriging_variance": total_variance / max(1, len(stratigraphy))
    }

@app.post("/api/virtual-drill")
async def virtual_drilling(request: VirtualDrillingRequest):
    try:
        if not request.boreholes or len(request.boreholes) == 0:
            raise HTTPException(status_code=400, detail="至少需要一个钻孔数据")
        
        result = predict_stratigraphy_at_point(
            request.boreholes,
            request.point_x,
            request.point_y,
            request.method
        )
        
        if result is None:
            raise HTTPException(status_code=500, detail="无法进行地层预测")
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/virtual-drill/batch")
async def virtual_drilling_batch(points: List[Tuple[float, float]], boreholes: List[BoreholeData], method: str = "kriging"):
    results = []
    for x, y in points:
        result = predict_stratigraphy_at_point(boreholes, x, y, method)
        if result:
            results.append(result)
    return results

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
