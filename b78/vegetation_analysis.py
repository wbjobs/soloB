import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
import pandas as pd
import logging
from typing import List, Dict, Tuple, Optional
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class NDVIAnalyzer:
    """NDVI 植被指数分析器"""

    @staticmethod
    def calculate_ndvi(
        image: np.ndarray,
        red_band_idx: int = 2,
        nir_band_idx: int = 3
    ) -> np.ndarray:
        """
        计算归一化植被指数 (NDVI)
        NDVI = (NIR - Red) / (NIR + Red)

        参数:
            image: 多光谱图像数组 (H, W, C)
            red_band_idx: 红光波段索引 (默认第3个波段，索引从0开始)
            nir_band_idx: 近红外波段索引 (默认第4个波段)

        返回:
            NDVI 数组 (H, W)，值范围 [-1, 1]
        """
        if len(image.shape) != 3:
            raise ValueError(f"期望3维图像数组，得到 {len(image.shape)} 维")

        num_bands = image.shape[2]
        if num_bands < 4:
            logger.warning(f"图像只有 {num_bands} 个波段，使用默认波段 (0=NIR, 1=Red)")
            if num_bands >= 2:
                red_band_idx = 0
                nir_band_idx = 1
            else:
                raise ValueError(f"至少需要2个波段才能计算 NDVI，当前有 {num_bands} 个波段")

        red = image[:, :, red_band_idx].astype(np.float32)
        nir = image[:, :, nir_band_idx].astype(np.float32)

        denominator = nir + red
        denominator[denominator == 0] = 1e-8

        ndvi = (nir - red) / denominator
        ndvi = np.clip(ndvi, -1, 1)

        return ndvi

    @staticmethod
    def calculate_ndvi_stats(ndvi: np.ndarray, mask: Optional[np.ndarray] = None) -> Dict:
        """
        计算 NDVI 的统计指标

        参数:
            ndvi: NDVI 数组
            mask: 可选的掩膜数组（True为有效区域）

        返回:
            统计指标字典
        """
        if mask is not None:
            valid_ndvi = ndvi[mask]
        else:
            valid_ndvi = ndvi.flatten()

        if len(valid_ndvi) == 0:
            return {
                "mean": 0,
                "median": 0,
                "std": 0,
                "min": 0,
                "max": 0,
                "q25": 0,
                "q75": 0,
                "vegetation_coverage": 0
            }

        vegetation_mask = valid_ndvi > 0.2
        vegetation_coverage = np.mean(vegetation_mask)

        stats = {
            "mean": float(np.mean(valid_ndvi)),
            "median": float(np.median(valid_ndvi)),
            "std": float(np.std(valid_ndvi)),
            "min": float(np.min(valid_ndvi)),
            "max": float(np.max(valid_ndvi)),
            "q25": float(np.percentile(valid_ndvi, 25)),
            "q75": float(np.percentile(valid_ndvi, 75)),
            "vegetation_coverage": float(vegetation_coverage),
            "healthy_vegetation_ratio": float(np.mean(valid_ndvi > 0.5))
        }

        return stats

    @staticmethod
    def classify_vegetation(ndvi: np.ndarray) -> np.ndarray:
        """
        根据 NDVI 值进行植被分类

        分类:
            - 无植被: NDVI < 0.2
            - 稀疏植被: 0.2 <= NDVI < 0.4
            - 中等植被: 0.4 <= NDVI < 0.6
            - 茂密植被: NDVI >= 0.6
        """
        classes = np.zeros(ndvi.shape, dtype=np.uint8)
        classes[(ndvi >= 0.2) & (ndvi < 0.4)] = 1
        classes[(ndvi >= 0.4) & (ndvi < 0.6)] = 2
        classes[ndvi >= 0.6] = 3

        return classes


class TimeSeriesAnalyzer:
    """时间序列分析器"""

    def __init__(self):
        self.ndvi_data = []
        self.dates = []

    def add_ndvi_data(self, ndvi: np.ndarray, date: Optional[datetime] = None):
        """添加一个时间点的 NDVI 数据"""
        if date is None:
            date = datetime.now()

        stats = NDVIAnalyzer.calculate_ndvi_stats(ndvi)
        self.ndvi_data.append(stats)
        self.dates.append(date)
        logger.info(f"添加时间点数据: {date.strftime('%Y-%m-%d')}, 平均NDVI: {stats['mean']:.3f}")

    def analyze_trend(self) -> Dict:
        """分析 NDVI 时间序列趋势"""
        if len(self.ndvi_data) < 2:
            return {"error": "至少需要2个时间点的数据进行趋势分析"}

        mean_values = [d["mean"] for d in self.ndvi_data]
        x = np.arange(len(mean_values))

        try:
            slope, intercept = np.polyfit(x, mean_values, 1)
        except Exception as e:
            logger.warning(f"趋势拟合失败: {e}")
            slope = 0
            intercept = 0

        if slope > 0.01:
            trend = "improving"
        elif slope < -0.01:
            trend = "degrading"
        else:
            trend = "stable"

        first_mean = mean_values[0]
        last_mean = mean_values[-1]
        change_pct = ((last_mean - first_mean) / abs(first_mean) * 100) if first_mean != 0 else 0

        analysis = {
            "trend": trend,
            "slope": float(slope),
            "intercept": float(intercept),
            "total_change_pct": float(change_pct),
            "num_time_points": len(self.ndvi_data),
            "date_range": {
                "start": self.dates[0].isoformat(),
                "end": self.dates[-1].isoformat()
            },
            "mean_ndvi_series": mean_values,
            "coverage_series": [d["vegetation_coverage"] for d in self.ndvi_data]
        }

        return analysis

    def generate_trend_chart(
        self,
        output_path: str,
        title: str = "NDVI 植被指数时间序列变化趋势",
        figsize: Tuple[int, int] = (12, 6)
    ) -> str:
        """生成 NDVI 变化趋势折线图"""
        if len(self.ndvi_data) < 2:
            logger.warning("数据点不足，无法生成图表")
            return ""

        plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
        plt.rcParams['axes.unicode_minus'] = False

        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=figsize)
        fig.suptitle(title, fontsize=14, fontweight='bold')

        mean_values = [d["mean"] for d in self.ndvi_data]
        dates = self.dates

        ax1.plot(dates, mean_values, 'b-o', linewidth=2, markersize=6, label='平均 NDVI')

        q25_values = [d["q25"] for d in self.ndvi_data]
        q75_values = [d["q75"] for d in self.ndvi_data]
        ax1.fill_between(dates, q25_values, q75_values, alpha=0.3, color='blue', label='NDVI 25%-75% 区间')

        ax1.set_ylabel('NDVI 值', fontsize=12)
        ax1.grid(True, alpha=0.3)
        ax1.legend(loc='upper left')
        ax1.set_ylim([-0.1, 1.0])

        ax1.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
        ax1.xaxis.set_major_locator(mdates.AutoDateLocator())

        coverage_values = [d["vegetation_coverage"] * 100 for d in self.ndvi_data]
        healthy_values = [d["healthy_vegetation_ratio"] * 100 for d in self.ndvi_data]

        ax2.plot(dates, coverage_values, 'g-s', linewidth=2, markersize=6, label='植被覆盖率')
        ax2.plot(dates, healthy_values, 'r-^', linewidth=2, markersize=6, label='健康植被比例')

        ax2.set_xlabel('日期', fontsize=12)
        ax2.set_ylabel('百分比 (%)', fontsize=12)
        ax2.grid(True, alpha=0.3)
        ax2.legend(loc='upper left')
        ax2.set_ylim([0, 100])

        ax2.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
        ax2.xaxis.set_major_locator(mdates.AutoDateLocator())

        plt.tight_layout()
        plt.savefig(output_path, dpi=150, bbox_inches='tight')
        plt.close()

        logger.info(f"趋势图表已保存: {output_path}")
        return output_path

    def generate_ndvi_distribution_chart(
        self,
        ndvi: np.ndarray,
        output_path: str,
        title: str = "NDVI 分布图"
    ) -> str:
        """生成单个 NDVI 图像的分布图"""
        plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
        plt.rcParams['axes.unicode_minus'] = False

        fig, axes = plt.subplots(1, 2, figsize=(14, 5))

        im = axes[0].imshow(ndvi, cmap='RdYlGn', vmin=-0.2, vmax=1.0)
        axes[0].set_title('NDVI 植被指数图', fontsize=12)
        axes[0].axis('off')
        plt.colorbar(im, ax=axes[0], fraction=0.046, pad=0.04)

        valid_ndvi = ndvi[~np.isnan(ndvi)]
        axes[1].hist(valid_ndvi, bins=50, range=(-0.2, 1.0), edgecolor='black', alpha=0.7)
        axes[1].axvline(x=0.2, color='orange', linestyle='--', linewidth=2, label='无植被阈值 (0.2)')
        axes[1].axvline(x=0.4, color='yellowgreen', linestyle='--', linewidth=2, label='稀疏植被阈值 (0.4)')
        axes[1].axvline(x=0.6, color='green', linestyle='--', linewidth=2, label='茂密植被阈值 (0.6)')
        axes[1].set_title('NDVI 分布直方图', fontsize=12)
        axes[1].set_xlabel('NDVI 值')
        axes[1].set_ylabel('像素数量')
        axes[1].legend()
        axes[1].grid(True, alpha=0.3)

        plt.suptitle(title, fontsize=14, fontweight='bold')
        plt.tight_layout()
        plt.savefig(output_path, dpi=150, bbox_inches='tight')
        plt.close()

        logger.info(f"NDVI 分布图已保存: {output_path}")
        return output_path

    def export_to_dataframe(self) -> pd.DataFrame:
        """导出时间序列数据为 DataFrame"""
        data = []
        for i, (date, stats) in enumerate(zip(self.dates, self.ndvi_data)):
            row = {
                "date": date,
                "time_point": i + 1,
                **stats
            }
            data.append(row)

        return pd.DataFrame(data)

    def export_csv(self, output_path: str) -> str:
        """导出时间序列数据为 CSV"""
        df = self.export_to_dataframe()
        df.to_csv(output_path, index=False, encoding='utf-8-sig')
        logger.info(f"CSV 数据已保存: {output_path}")
        return output_path


class VegetationHealthPipeline:
    """植被健康分析完整流程"""

    def __init__(self):
        self.ndvi_analyzer = NDVIAnalyzer()
        self.ts_analyzer = TimeSeriesAnalyzer()

    def process_images(
        self,
        images: List[np.ndarray],
        output_dir: str,
        task_id: str,
        dates: Optional[List[datetime]] = None,
        red_band_idx: int = 2,
        nir_band_idx: int = 3
    ) -> Dict:
        """
        处理多时相图像，执行完整的植被健康分析

        参数:
            images: 多时相图像列表
            output_dir: 输出目录
            task_id: 任务ID
            dates: 可选的日期列表
            red_band_idx: 红光波段索引
            nir_band_idx: 近红外波段索引

        返回:
            分析结果字典
        """
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        logger.info(f"开始植被健康分析，共 {len(images)} 张图像")

        if dates is None:
            base_date = datetime.now()
            dates = [base_date.replace(hour=0, minute=0, second=0, microsecond=0)
                     for _ in range(len(images))]

        ndvi_results = []
        for i, (image, date) in enumerate(zip(images, dates)):
            try:
                ndvi = self.ndvi_analyzer.calculate_ndvi(image, red_band_idx, nir_band_idx)
                stats = self.ndvi_analyzer.calculate_ndvi_stats(ndvi)

                self.ts_analyzer.add_ndvi_data(ndvi, date)

                dist_chart_path = output_path / f"{task_id}_ndvi_distribution_{i}.png"
                self.ts_analyzer.generate_ndvi_distribution_chart(
                    ndvi, str(dist_chart_path), f"NDVI 分布图 - 时相 {i+1}"
                )

                ndvi_results.append({
                    "time_point": i,
                    "date": date.isoformat(),
                    "stats": stats,
                    "distribution_chart": str(dist_chart_path.name)
                })

                logger.info(f"时相 {i+1} 分析完成: 平均NDVI={stats['mean']:.3f}")

            except Exception as e:
                logger.error(f"时相 {i+1} 分析失败: {e}", exc_info=True)
                raise

        trend_chart_path = output_path / f"{task_id}_ndvi_trend.png"
        self.ts_analyzer.generate_trend_chart(str(trend_chart_path), f"{task_id} NDVI 变化趋势")

        csv_path = output_path / f"{task_id}_ndvi_timeseries.csv"
        self.ts_analyzer.export_csv(str(csv_path))

        trend_analysis = self.ts_analyzer.analyze_trend()

        result = {
            "task_id": task_id,
            "num_time_points": len(images),
            "ndvi_results": ndvi_results,
            "trend_analysis": trend_analysis,
            "trend_chart": str(trend_chart_path.name),
            "csv_file": str(csv_path.name)
        }

        logger.info(f"植被健康分析完成，趋势: {trend_analysis.get('trend', 'unknown')}")
        return result
