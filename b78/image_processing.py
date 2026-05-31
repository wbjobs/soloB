import numpy as np
import cv2
from scipy import ndimage
from skimage import exposure, img_as_float
from typing import List, Tuple, Optional
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class GeoTIFFProcessor:
    @staticmethod
    def read_geotiff_gdal(file_path: str) -> Tuple[np.ndarray, dict]:
        try:
            from osgeo import gdal
            dataset = gdal.Open(file_path)
            if dataset is None:
                raise ValueError(f"Cannot open file: {file_path}")

            bands = []
            for i in range(1, dataset.RasterCount + 1):
                band = dataset.GetRasterBand(i)
                band_data = band.ReadAsArray()
                bands.append(band_data)

            image = np.stack(bands, axis=-1)

            geo_transform = dataset.GetGeoTransform()
            projection = dataset.GetProjection()
            metadata = {
                "geo_transform": geo_transform,
                "projection": projection,
                "width": dataset.RasterXSize,
                "height": dataset.RasterYSize,
                "bands": dataset.RasterCount
            }

            dataset = None
            return image, metadata
        except ImportError:
            logger.warning("GDAL not available, using fallback numpy loader")
            return GeoTIFFProcessor._read_fallback(file_path)

    @staticmethod
    def _read_fallback(file_path: str) -> Tuple[np.ndarray, dict]:
        image = cv2.imread(file_path, cv2.IMREAD_UNCHANGED)
        if image is None:
            raise ValueError(f"Cannot read image: {file_path}")
        if len(image.shape) == 2:
            image = image[:, :, np.newaxis]
        metadata = {
            "geo_transform": None,
            "projection": None,
            "width": image.shape[1],
            "height": image.shape[0],
            "bands": image.shape[2]
        }
        return image, metadata

    @staticmethod
    def write_geotiff_gdal(file_path: str, image: np.ndarray, metadata: dict):
        try:
            from osgeo import gdal, osr
            driver = gdal.GetDriverByName('GTiff')
            height, width, bands = image.shape

            dataset = driver.Create(
                file_path, width, height, bands,
                gdal.GDT_Float32,
                options=['COMPRESS=LZW']
            )

            if metadata.get("geo_transform"):
                dataset.SetGeoTransform(metadata["geo_transform"])
            if metadata.get("projection"):
                dataset.SetProjection(metadata["projection"])

            for i in range(bands):
                band = dataset.GetRasterBand(i + 1)
                band.WriteArray(image[:, :, i])
                band.FlushCache()

            dataset = None
            logger.info(f"GeoTIFF saved: {file_path}")
        except ImportError:
            logger.warning("GDAL not available, saving as PNG")
            cv2.imwrite(file_path.replace('.tif', '.png'),
                        (image * 255).astype(np.uint8))


class CloudDetector:
    @staticmethod
    def detect_clouds(image: np.ndarray, cloud_threshold: float = 0.6) -> np.ndarray:
        if len(image.shape) == 2:
            image = image[:, :, np.newaxis]

        if image.shape[-1] >= 3:
            rgb = image[:, :, :3]
            brightness = np.mean(rgb, axis=-1)
        else:
            brightness = image[:, :, 0]

        brightness = img_as_float(brightness)
        brightness = np.clip(brightness, 0, 1)

        cloud_mask = brightness > cloud_threshold

        cloud_mask = ndimage.binary_opening(cloud_mask, structure=np.ones((3, 3)))
        cloud_mask = ndimage.binary_closing(cloud_mask, structure=np.ones((5, 5)))

        min_cloud_size = 100
        labeled, num_features = ndimage.label(cloud_mask)
        for i in range(1, num_features + 1):
            if np.sum(labeled == i) < min_cloud_size:
                cloud_mask[labeled == i] = False

        return cloud_mask.astype(np.float32)


class ImageRegistrar:
    @staticmethod
    def register_images(reference: np.ndarray, moving: np.ndarray) -> np.ndarray:
        if len(reference.shape) > 2:
            ref_gray = np.mean(reference[:, :, :3], axis=-1)
        else:
            ref_gray = reference

        if len(moving.shape) > 2:
            mov_gray = np.mean(moving[:, :, :3], axis=-1)
        else:
            mov_gray = moving

        ref_gray = (np.clip(ref_gray, 0, 1) * 255).astype(np.uint8)
        mov_gray = (np.clip(mov_gray, 0, 1) * 255).astype(np.uint8)

        warp_matrix = np.eye(2, 3, dtype=np.float32)
        criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 5000, 1e-6)

        try:
            _, warp_matrix = cv2.findTransformECC(
                mov_gray, ref_gray, warp_matrix,
                cv2.MOTION_AFFINE, criteria, None, 5
            )
        except Exception as e:
            logger.warning(f"ECC registration failed: {e}, using identity")
            return moving

        height, width = ref_gray.shape
        registered = np.zeros_like(moving, dtype=np.float32)

        if len(moving.shape) == 3:
            for band in range(moving.shape[-1]):
                registered[:, :, band] = cv2.warpAffine(
                    moving[:, :, band], warp_matrix, (width, height),
                    flags=cv2.INTER_LINEAR
                )
        else:
            registered = cv2.warpAffine(
                moving, warp_matrix, (width, height),
                flags=cv2.INTER_LINEAR
            )

        return registered


class PoissonBlender:
    @staticmethod
    def poisson_blend(
        target: np.ndarray,
        source: np.ndarray,
        mask: np.ndarray
    ) -> np.ndarray:
        result = target.copy()

        if len(target.shape) == 3:
            for band in range(target.shape[-1]):
                result[:, :, band] = PoissonBlender._blend_single_channel(
                    target[:, :, band], source[:, :, band], mask
                )
        else:
            result = PoissonBlender._blend_single_channel(target, source, mask)

        return result

    @staticmethod
    def _blend_single_channel(
        target: np.ndarray,
        source: np.ndarray,
        mask: np.ndarray
    ) -> np.ndarray:
        from scipy.ndimage import laplace

        mask_binary = mask > 0.5
        if not np.any(mask_binary):
            return target

        result = target.copy()

        source_normalized = PoissonBlender._normalize_intensity(
            source, target, mask_binary
        )

        result[mask_binary] = source_normalized[mask_binary]

        blended = PoissonBlender._smooth_boundary(result, target, mask_binary)

        return blended

    @staticmethod
    def _normalize_intensity(
        source: np.ndarray,
        target: np.ndarray,
        mask: np.ndarray
    ) -> np.ndarray:
        source_region = source[mask]
        target_region = target[mask]

        if len(source_region) == 0 or len(target_region) == 0:
            return source

        src_mean = np.mean(source_region)
        tgt_mean = np.mean(target_region)
        src_std = np.std(source_region) + 1e-8
        tgt_std = np.std(target_region) + 1e-8

        normalized = (source - src_mean) * (tgt_std / src_std) + tgt_mean
        return np.clip(normalized, 0, 1)

    @staticmethod
    def _smooth_boundary(
        image: np.ndarray,
        target: np.ndarray,
        mask: np.ndarray
    ) -> np.ndarray:
        from scipy.ndimage import binary_dilation, distance_transform_edt

        dilated_mask = binary_dilation(mask, structure=np.ones((5, 5)))
        boundary = dilated_mask & ~mask

        if not np.any(boundary):
            return image

        dist = distance_transform_edt(mask)
        max_dist = np.max(dist) if np.max(dist) > 0 else 1
        alpha = np.clip(dist / max_dist, 0, 1)

        result = image * alpha + target * (1 - alpha)
        return result


class CloudRemovalPipeline:
    def __init__(self):
        self.processor = GeoTIFFProcessor()
        self.detector = CloudDetector()
        self.registrar = ImageRegistrar()
        self.blender = PoissonBlender()

    def process(
        self,
        image_paths: List[str],
        output_path: str,
        cloud_threshold: float = 0.6
    ) -> dict:
        logger.info(f"Starting cloud removal pipeline with {len(image_paths)} images")

        images = []
        metadata_list = []

        for path in image_paths:
            img, meta = self.processor.read_geotiff_gdal(path)
            img = img_as_float(img)
            images.append(img)
            metadata_list.append(meta)
            logger.info(f"Loaded {path}: shape={img.shape}")

        reference_idx = self._select_reference_image(images)
        reference = images[reference_idx]
        reference_meta = metadata_list[reference_idx]
        logger.info(f"Selected reference image index: {reference_idx}")

        registered_images = []
        for i, img in enumerate(images):
            if i != reference_idx:
                registered = self.registrar.register_images(reference, img)
                registered_images.append(registered)
            else:
                registered_images.append(reference)

        cloud_masks = []
        for img in registered_images:
            mask = self.detector.detect_clouds(img, cloud_threshold)
            cloud_masks.append(mask)
            logger.info(f"Cloud coverage: {np.mean(mask) * 100:.1f}%")

        result = self._fuse_images(registered_images, cloud_masks)

        self.processor.write_geotiff_gdal(output_path, result, reference_meta)

        stats = {
            "num_images": len(image_paths),
            "reference_index": reference_idx,
            "cloud_coverage_per_image": [float(np.mean(m)) for m in cloud_masks],
            "output_shape": result.shape,
            "output_path": output_path
        }

        logger.info(f"Processing complete: {stats}")
        return stats

    def _select_reference_image(self, images: List[np.ndarray]) -> int:
        cloud_scores = []
        for img in images:
            if len(img.shape) >= 3:
                brightness = np.mean(img[:, :, :3], axis=-1)
            else:
                brightness = img[:, :, 0]
            brightness = img_as_float(brightness)
            brightness = np.clip(brightness, 0, 1)
            cloud_score = np.mean(brightness > 0.6)
            cloud_scores.append(cloud_score)

        return int(np.argmin(cloud_scores))

    def _fuse_images(
        self,
        images: List[np.ndarray],
        masks: List[np.ndarray]
    ) -> np.ndarray:
        result = images[0].copy()
        combined_mask = masks[0].copy()

        for i in range(1, len(images)):
            fill_region = combined_mask > 0.5
            if np.any(fill_region):
                source_mask = masks[i] < 0.5
                valid_fill = fill_region & source_mask

                if np.any(valid_fill):
                    blend_mask = valid_fill.astype(np.float32)
                    result = self.blender.poisson_blend(
                        result, images[i], blend_mask
                    )

                    combined_mask[valid_fill] = 0

        if np.any(combined_mask > 0.5):
            logger.warning(f"Remaining cloud coverage: {np.mean(combined_mask) * 100:.1f}%")

        return result
