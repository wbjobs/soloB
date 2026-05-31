import os
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


class TimeSeriesAnalyzer:
    def __init__(self, file_path: str, variable: Optional[str] = None):
        self.file_path = file_path
        self.variable = variable
        self._data_cache = None
        self._transform = None
        self._crs = None
        self._times = None
        self._lats = None
        self._lons = None

    def load_data(self):
        ext = os.path.splitext(self.file_path)[1].lower()

        if ext in [".nc", ".nc4"]:
            return self._load_netcdf()
        elif ext in [".tif", ".tiff"]:
            return self._load_geotiff()
        else:
            raise ValueError(f"Unsupported format: {ext}")

    def _load_netcdf(self):
        import netCDF4

        ds = netCDF4.Dataset(self.file_path, "r")

        lat_var = self._find_var(ds, ["lat", "latitude", "y", "yc"])
        lon_var = self._find_var(ds, ["lon", "longitude", "x", "xc"])
        time_var = self._find_var(ds, ["time", "t"])
        data_var = self.variable or self._find_data_var(ds, time_var, lat_var, lon_var)

        if not data_var:
            raise ValueError("Could not find data variable")

        data = ds.variables[data_var][:]
        lats = ds.variables[lat_var][:]
        lons = ds.variables[lon_var][:]
        times = ds.variables[time_var][:] if time_var else None

        ds.close()

        if times is not None and len(data.shape) == 3:
            self._data_cache = data
        elif len(data.shape) == 2:
            self._data_cache = data[np.newaxis, :, :]
        else:
            raise ValueError(f"Unsupported data shape: {data.shape}")

        self._lats = lats
        self._lons = lons
        self._times = times

        if len(lons) >= 2 and len(lats) >= 2:
            dx = float(lons[1] - lons[0])
            dy = float(lats[1] - lats[0])
            self._transform = (
                float(np.min(lons)), dx, 0.0,
                float(np.max(lats)), 0.0, -dy,
            )
        self._crs = "EPSG:4326"

        return self._data_cache.shape

    def _load_geotiff(self):
        import rasterio

        ds = rasterio.open(self.file_path)
        data = ds.read()
        self._transform = ds.transform
        self._crs = str(ds.crs)
        ds.close()

        if len(data.shape) == 3:
            self._data_cache = data
        elif len(data.shape) == 2:
            self._data_cache = data[np.newaxis, :, :]
        else:
            raise ValueError(f"Unsupported data shape: {data.shape}")

        return self._data_cache.shape

    def _find_var(self, ds, candidates: List[str]) -> Optional[str]:
        for name in candidates:
            if name in ds.variables:
                return name
        return None

    def _find_data_var(self, ds, time_var, lat_var, lon_var) -> Optional[str]:
        for name, var in ds.variables.items():
            dims = var.dimensions
            if time_var and time_var in dims and lat_var in dims and lon_var in dims:
                return name
            if lat_var in dims and lon_var in dims:
                return name
        return None

    def compute_ndvi(self, nir_band: int = 1, red_band: int = 0) -> np.ndarray:
        if self._data_cache is None:
            self.load_data()

        data = self._data_cache.astype(np.float64)

        if data.shape[0] < 2:
            raise ValueError("Need at least 2 bands for NDVI (NIR + Red)")

        nir = data[nir_band] if data.shape[0] > nir_band else data[-1]
        red = data[red_band] if data.shape[0] > red_band else data[0]

        ndvi = (nir - red) / (nir + red + 1e-10)
        ndvi = np.clip(ndvi, -1.0, 1.0)

        return ndvi

    def detect_anomalies(
        self,
        window_size: int = 5,
        sigma_threshold: float = 2.0,
        method: str = "rolling",
    ) -> Dict[str, Any]:
        if self._data_cache is None:
            self.load_data()

        data = self._data_cache.astype(np.float64)
        num_time = data.shape[0]

        if method == "rolling":
            return self._rolling_anomaly_detection(data, window_size, sigma_threshold)
        elif method == "global":
            return self._global_anomaly_detection(data, sigma_threshold)
        else:
            raise ValueError(f"Unknown method: {method}")

    def _global_anomaly_detection(self, data: np.ndarray, sigma: float) -> Dict[str, Any]:
        valid_mask = np.isfinite(data)

        mean = np.nanmean(data, axis=0)
        std = np.nanstd(data, axis=0)
        std = np.where(std < 1e-10, 1e-10, std)

        anomaly_maps = []
        for t in range(data.shape[0]):
            current = data[t]
            z_score = (current - mean) / std
            anomaly = np.abs(z_score) > sigma
            anomaly_maps.append(anomaly.astype(np.float32))

        anomaly_count = np.sum([a for a in anomaly_maps], axis=0)
        total_time = data.shape[0]
        anomaly_ratio = anomaly_count / total_time

        return {
            "anomaly_maps": np.array(anomaly_maps),
            "mean": mean,
            "std": std,
            "anomaly_count": anomaly_count,
            "anomaly_ratio": anomaly_ratio,
            "sigma_threshold": sigma,
            "method": "global",
        }

    def _rolling_anomaly_detection(
        self,
        data: np.ndarray,
        window_size: int,
        sigma: float,
    ) -> Dict[str, Any]:
        num_time = data.shape[0]
        half_window = window_size // 2

        anomaly_maps = []
        rolling_means = []
        rolling_stds = []

        for t in range(num_time):
            start = max(0, t - half_window)
            end = min(num_time, t + half_window + 1)

            window_data = data[start:end]
            valid_mask = np.isfinite(window_data)

            win_mean = np.nanmean(window_data, axis=0)
            win_std = np.nanstd(window_data, axis=0)
            win_std = np.where(win_std < 1e-10, 1e-10, win_std)

            rolling_means.append(win_mean)
            rolling_stds.append(win_std)

            current = data[t]
            z_score = (current - win_mean) / win_std
            anomaly = np.abs(z_score) > sigma
            anomaly_maps.append(anomaly.astype(np.float32))

        anomaly_count = np.sum([a for a in anomaly_maps], axis=0)
        anomaly_ratio = anomaly_count / num_time

        return {
            "anomaly_maps": np.array(anomaly_maps),
            "rolling_mean": np.array(rolling_means),
            "rolling_std": np.array(rolling_stds),
            "anomaly_count": anomaly_count,
            "anomaly_ratio": anomaly_ratio,
            "sigma_threshold": sigma,
            "window_size": window_size,
            "method": "rolling",
        }

    def get_geo_info(self) -> Dict[str, Any]:
        return {
            "transform": self._transform,
            "crs": self._crs,
            "lats": self._lats,
            "lons": self._lons,
            "times": self._times,
        }

    def close(self):
        self._data_cache = None
