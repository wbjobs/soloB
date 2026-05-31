import os
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


class RasterParser(ABC):
    @abstractmethod
    def get_metadata(self) -> Dict[str, Any]:
        pass

    @abstractmethod
    def get_bounds(self) -> Tuple[float, float, float, float]:
        pass

    @abstractmethod
    def extract_point(self, lon: float, lat: float) -> Dict[str, Any]:
        pass

    @abstractmethod
    def compute_zonal_stats(self, polygon_coords: List[Tuple[float, float]]) -> Dict[str, Any]:
        pass

    @abstractmethod
    def close(self):
        pass


class GeoTIFFParser(RasterParser):
    def __init__(self, file_path: str):
        import rasterio

        self.dataset = rasterio.open(file_path)
        self.transform = self.dataset.transform
        self.crs = self.dataset.crs

    def get_metadata(self) -> Dict[str, Any]:
        return {
            "crs": str(self.dataset.crs),
            "width": self.dataset.width,
            "height": self.dataset.height,
            "num_bands": self.dataset.count,
        }

    def get_bounds(self) -> Tuple[float, float, float, float]:
        return self.dataset.bounds.left, self.dataset.bounds.bottom, self.dataset.bounds.right, self.dataset.bounds.top

    def _pixel_coord(self, lon: float, lat: float) -> Tuple[int, int]:
        inv_transform = ~self.transform
        col, row = inv_transform * (lon, lat)
        return int(row), int(col)

    def extract_point(self, lon: float, lat: float) -> Dict[str, Any]:
        row, col = self._pixel_coord(lon, lat)
        if not (0 <= row < self.dataset.height and 0 <= col < self.dataset.width):
            return {"valid": False, "values": []}

        values = []
        for band_idx in range(1, self.dataset.count + 1):
            band = self.dataset.read(band_idx)
            val = float(band[row, col])
            values.append(val)

        return {"valid": True, "values": values, "time_steps": []}

    def compute_zonal_stats(self, polygon_coords: List[Tuple[float, float]]) -> Dict[str, Any]:
        from rasterio.features import geometry_mask
        from shapely.geometry import Polygon

        polygon = Polygon(polygon_coords)
        mask = geometry_mask([polygon], out_shape=self.dataset.shape, transform=self.transform, invert=True)

        all_values = []
        for band_idx in range(1, self.dataset.count + 1):
            band_data = self.dataset.read(band_idx)
            masked_values = band_data[mask]
            all_values.extend(masked_values.tolist())

        if not all_values:
            return {"valid": False}

        arr = np.array(all_values, dtype=np.float64)
        arr = arr[np.isfinite(arr)]

        if len(arr) == 0:
            return {"valid": False}

        return {
            "valid": True,
            "mean": float(np.mean(arr)),
            "max": float(np.max(arr)),
            "min": float(np.min(arr)),
            "std": float(np.std(arr)),
            "count": int(len(arr)),
        }

    def close(self):
        self.dataset.close()


class NetCDFParser(RasterParser):
    def __init__(self, file_path: str, variable: Optional[str] = None):
        import netCDF4

        self.dataset = netCDF4.Dataset(file_path, "r")
        self.lat_var = self._find_variable(["lat", "latitude", "y", "yc"])
        self.lon_var = self._find_variable(["lon", "longitude", "x", "xc"])
        self.time_var = self._find_variable(["time", "t"])
        self.variable = variable or self._find_data_variable()

    def _find_variable(self, candidates: List[str]) -> Optional[str]:
        for name in candidates:
            if name in self.dataset.variables:
                return name
        return None

    def _find_data_variable(self) -> str:
        for name, var in self.dataset.variables.items():
            dims = var.dimensions
            if self.time_var and self.time_var in dims and self.lat_var in dims and self.lon_var in dims:
                return name
            if self.lat_var in dims and self.lon_var in dims:
                return name
        raise ValueError("Could not determine data variable")

    def get_metadata(self) -> Dict[str, Any]:
        return {
            "variable": self.variable,
            "has_time": self.time_var is not None,
            "num_bands": len(self.dataset.variables[self.variable].shape) - 2 if self.time_var else 1,
            "time_units": str(self.dataset.variables[self.time_var].units) if self.time_var else None,
        }

    def get_bounds(self) -> Tuple[float, float, float, float]:
        lats = self.dataset.variables[self.lat_var][:]
        lons = self.dataset.variables[self.lon_var][:]
        return float(np.min(lons)), float(np.min(lats)), float(np.max(lons)), float(np.max(lats))

    def extract_point(self, lon: float, lat: float) -> Dict[str, Any]:
        lats = self.dataset.variables[self.lat_var][:]
        lons = self.dataset.variables[self.lon_var][:]

        lat_idx = int(np.argmin(np.abs(lats - lat)))
        lon_idx = int(np.argmin(np.abs(lons - lon)))

        if abs(lats[lat_idx] - lat) > 1.0 or abs(lons[lon_idx] - lon) > 1.0:
            return {"valid": False, "values": []}

        var_data = self.dataset.variables[self.variable]
        time_steps = []
        values = []

        if self.time_var:
            times = self.dataset.variables[self.time_var][:]
            for t_idx in range(len(times)):
                val = var_data[t_idx, lat_idx, lon_idx]
                values.append(float(val))
                time_steps.append(float(times[t_idx]))
        else:
            val = var_data[lat_idx, lon_idx]
            values.append(float(val))

        return {"valid": True, "values": values, "time_steps": time_steps}

    def compute_zonal_stats(self, polygon_coords: List[Tuple[float, float]]) -> Dict[str, Any]:
        from shapely.geometry import Polygon

        polygon = Polygon(polygon_coords)
        minx, miny, maxx, maxy = polygon.bounds

        lats = self.dataset.variables[self.lat_var][:]
        lons = self.dataset.variables[self.lon_var][:]

        lon_mask = (lons >= minx) & (lons <= maxx)
        lat_mask = (lats >= miny) & (lats <= maxy)

        lon_indices = np.where(lon_mask)[0]
        lat_indices = np.where(lat_mask)[0]

        if len(lon_indices) == 0 or len(lat_indices) == 0:
            return {"valid": False}

        var_data = self.dataset.variables[self.variable]
        all_values = []

        if self.time_var:
            for t_idx in range(len(self.dataset.variables[self.time_var][:])):
                for lat_idx in lat_indices:
                    for lon_idx in lon_indices:
                        pt_lon = float(lons[lon_idx])
                        pt_lat = float(lats[lat_idx])
                        if polygon.contains(Polygon([(pt_lon, pt_lat)]).centroid):
                            val = var_data[t_idx, lat_idx, lon_idx]
                            if np.isfinite(val):
                                all_values.append(float(val))
        else:
            for lat_idx in lat_indices:
                for lon_idx in lon_indices:
                    pt_lon = float(lons[lon_idx])
                    pt_lat = float(lats[lat_idx])
                    if polygon.contains(Polygon([(pt_lon, pt_lat)]).centroid):
                        val = var_data[lat_idx, lon_idx]
                        if np.isfinite(val):
                            all_values.append(float(val))

        if not all_values:
            return {"valid": False}

        arr = np.array(all_values, dtype=np.float64)

        return {
            "valid": True,
            "mean": float(np.mean(arr)),
            "max": float(np.max(arr)),
            "min": float(np.min(arr)),
            "std": float(np.std(arr)),
            "count": int(len(arr)),
        }

    def close(self):
        self.dataset.close()


def get_parser(file_path: str, variable: Optional[str] = None) -> RasterParser:
    ext = os.path.splitext(file_path)[1].lower()
    if ext in [".tif", ".tiff"]:
        return GeoTIFFParser(file_path)
    elif ext in [".nc", ".nc4"]:
        return NetCDFParser(file_path, variable)
    else:
        raise ValueError(f"Unsupported file format: {ext}")
