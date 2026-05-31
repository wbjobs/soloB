import base64
import io
import os
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

import numpy as np

from app.config import settings


class RasterOutputService:
    def __init__(self):
        self.results_dir = settings.results_path
        os.makedirs(self.results_dir, exist_ok=True)

    def save_geotiff(
        self,
        data: np.ndarray,
        transform,
        crs: str,
        prefix: str = "analysis",
    ) -> Dict[str, str]:
        import rasterio
        from rasterio.crs import CRS

        filename = f"{prefix}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.tif"
        file_path = os.path.join(self.results_dir, filename)

        if len(data.shape) == 2:
            data = data[np.newaxis, :, :]

        count = data.shape[0]
        height, width = data.shape[1], data.shape[2]

        if transform is None:
            transform = rasterio.transform.from_bounds(-180, -90, 180, 90, width, height)

        crs_obj = CRS.from_string(crs) if crs else CRS.from_epsg(4326)

        with rasterio.open(
            file_path,
            "w",
            driver="GTiff",
            height=height,
            width=width,
            count=count,
            dtype=data.dtype,
            crs=crs_obj,
            transform=transform,
        ) as dst:
            for i in range(count):
                dst.write(data[i], i + 1)

        download_url = f"{settings.result_url_prefix}/download/{filename}"

        return {
            "file_path": file_path,
            "filename": filename,
            "download_url": download_url,
        }

    def generate_thumbnail_base64(
        self,
        data: np.ndarray,
        max_size: int = 256,
        cmap: str = "viridis",
    ) -> Optional[str]:
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            from matplotlib.colors import Normalize

            if len(data.shape) == 3:
                data_2d = data[0]
            else:
                data_2d = data

            valid_data = data_2d[np.isfinite(data_2d)]
            if len(valid_data) == 0:
                return None

            vmin = float(np.nanmin(data_2d))
            vmax = float(np.nanmax(data_2d))

            fig, ax = plt.subplots(figsize=(4, 4))
            im = ax.imshow(data_2d, cmap=cmap, norm=Normalize(vmin=vmin, vmax=vmax))
            ax.axis("off")
            plt.colorbar(im, ax=ax, shrink=0.8)
            plt.tight_layout()

            buf = io.BytesIO()
            plt.savefig(buf, format="png", dpi=72, bbox_inches="tight", pad_inches=0)
            plt.close(fig)

            buf.seek(0)
            img_base64 = base64.b64encode(buf.read()).decode("utf-8")

            return f"data:image/png;base64,{img_base64}"

        except Exception as e:
            print(f"Thumbnail generation error: {e}")
            return None

    def save_result_json(
        self,
        data: dict,
        task_type: str,
    ) -> Dict[str, str]:
        import json

        filename = f"{task_type}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.json"
        file_path = os.path.join(self.results_dir, filename)

        with open(file_path, "w") as f:
            json.dump(data, f, indent=2, default=str)

        download_url = f"{settings.result_url_prefix}/download/{filename}"

        return {
            "file_path": file_path,
            "filename": filename,
            "download_url": download_url,
        }


raster_output = RasterOutputService()
