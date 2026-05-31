from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import rasterio
from rasterio.io import MemoryFile
import numpy as np
import json
from typing import Dict, Any

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_geojson_bounds(transform, width, height, crs):
    min_x = transform.c
    max_y = transform.f
    max_x = transform.c + transform.a * width
    min_y = transform.f + transform.e * height
    
    coordinates = [
        [
            [min_x, min_y],
            [max_x, min_y],
            [max_x, max_y],
            [min_x, max_y],
            [min_x, min_y]
        ]
    ]
    
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "Image Boundary"
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": coordinates
                }
            }
        ],
        "crs": {
            "type": "name",
            "properties": {
                "name": str(crs)
            }
        }
    }

@app.post("/api/geotiff/metadata")
async def get_geotiff_metadata(file: UploadFile = File(...)) -> Dict[str, Any]:
    contents = await file.read()
    
    with MemoryFile(contents) as memfile:
        with memfile.open() as dataset:
            transform = dataset.transform
            width = dataset.width
            height = dataset.height
            crs = dataset.crs
            count = dataset.count
            dtype = dataset.dtypes[0]
            nodata = dataset.nodata
            
            metadata = {
                "width": width,
                "height": height,
                "bands": count,
                "dtype": dtype,
                "nodata": nodata,
                "crs": str(crs) if crs else None,
                "transform": [
                    transform.a, transform.b, transform.c,
                    transform.d, transform.e, transform.f,
                    transform.g, transform.h, transform.i
                ],
                "bounds": {
                    "left": transform.c,
                    "bottom": transform.f + transform.e * height,
                    "right": transform.c + transform.a * width,
                    "top": transform.f
                }
            }
            
            geojson = get_geojson_bounds(transform, width, height, crs)
            
            return {
                "metadata": metadata,
                "geojson": geojson
            }

@app.post("/api/geotiff/thumbnail")
async def get_geotiff_thumbnail(file: UploadFile = File(...)):
    contents = await file.read()
    
    with MemoryFile(contents) as memfile:
        with memfile.open() as dataset:
            data = dataset.read()
            
            if data.shape[0] >= 3:
                rgb = data[:3]
            else:
                rgb = np.stack([data[0]] * 3)
            
            rgb = np.clip(rgb, 0, 255).astype(np.uint8)
            rgb = np.transpose(rgb, (1, 2, 0))
            
            import base64
            from io import BytesIO
            from PIL import Image
            
            img = Image.fromarray(rgb)
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            img_str = base64.b64encode(buffer.getvalue()).decode()
            
            return {
                "thumbnail": f"data:image/png;base64,{img_str}",
                "width": rgb.shape[1],
                "height": rgb.shape[0]
            }

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)