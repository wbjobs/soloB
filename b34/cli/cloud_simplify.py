#!/usr/bin/env python3
import argparse
import sys
import os
import random
import math

try:
    import open3d as o3d
except ImportError:
    print("错误: 请先安装 open3d: pip install open3d")
    sys.exit(1)

import numpy as np

def calculate_voxel_size(point_cloud, target_points):
    if len(point_cloud.points) <= target_points:
        return 0.01
    
    points = np.asarray(point_cloud.points)
    bbox_min = points.min(axis=0)
    bbox_max = points.max(axis=0)
    volume = np.prod(bbox_max - bbox_min)
    
    if volume <= 0:
        return 0.01
    
    voxel_volume = volume / target_points
    voxel_size = voxel_volume ** (1/3)
    
    return max(voxel_size, 0.001)

def calculate_poisson_radius(point_cloud, target_points):
    points = np.asarray(point_cloud.points)
    original_count = len(points)
    
    if original_count <= target_points:
        return 0.01
    
    bbox_min = points.min(axis=0)
    bbox_max = points.max(axis=0)
    volume = np.prod(bbox_max - bbox_min)
    
    if volume <= 0:
        return 0.01
    
    radius = (3 * volume / (4 * np.pi * target_points)) ** (1/3) * 0.8
    
    return max(radius, 0.001)

class PoissonDiskSampler:
    def __init__(self, radius, points, k=30):
        self.radius = radius
        self.points = points
        self.k = k
        self.n = len(points)
        
        if self.n == 0:
            return
        
        self.bbox_min = points.min(axis=0)
        self.bbox_max = points.max(axis=0)
        
        self.cell_size = radius / math.sqrt(3)
        
        grid_dims = np.ceil((self.bbox_max - self.bbox_min) / self.cell_size).astype(int)
        self.grid_dims = np.maximum(grid_dims, 1)
        
        self.grid = {}
        for idx, p in enumerate(points):
            grid_idx = tuple(np.floor((p - self.bbox_min) / self.cell_size).astype(int))
            if grid_idx not in self.grid:
                self.grid[grid_idx] = []
            self.grid[grid_idx].append(idx)
    
    def _get_neighbors(self, grid_idx):
        neighbors = []
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                for dz in [-1, 0, 1]:
                    neighbor_idx = (grid_idx[0] + dx, grid_idx[1] + dy, grid_idx[2] + dz)
                    if neighbor_idx in self.grid:
                        neighbors.extend(self.grid[neighbor_idx])
        return neighbors
    
    def _is_valid(self, point, selected_set):
        grid_idx = tuple(np.floor((point - self.bbox_min) / self.cell_size).astype(int))
        neighbors = self._get_neighbors(grid_idx)
        
        for neighbor_idx in neighbors:
            if neighbor_idx in selected_set:
                dist = np.linalg.norm(point - self.points[neighbor_idx])
                if dist < self.radius:
                    return False
        return True
    
    def sample(self, target_count=None):
        if self.n == 0:
            return []
        
        if target_count is None:
            target_count = self.n
        
        sampled_indices = []
        selected_set = set()
        active_list = []
        
        start_idx = random.randint(0, self.n - 1)
        sampled_indices.append(start_idx)
        selected_set.add(start_idx)
        active_list.append(start_idx)
        
        iterations = 0
        max_iterations = self.n * 10
        
        while active_list and len(sampled_indices) < target_count and iterations < max_iterations:
            iterations += 1
            active_idx = random.choice(range(len(active_list)))
            current_idx = active_list[active_idx]
            current_point = self.points[current_idx]
            
            found = False
            
            for _ in range(self.k):
                theta = random.uniform(0, 2 * np.pi)
                phi = random.uniform(0, np.pi)
                r = random.uniform(self.radius, 2 * self.radius)
                
                x = r * np.sin(phi) * np.cos(theta)
                y = r * np.sin(phi) * np.sin(theta)
                z = r * np.cos(phi)
                
                candidate = current_point + np.array([x, y, z])
                
                if not (np.all(candidate >= self.bbox_min) and np.all(candidate <= self.bbox_max)):
                    continue
                
                min_dist = float('inf')
                nearest_idx = None
                
                grid_idx = tuple(np.floor((candidate - self.bbox_min) / self.cell_size).astype(int))
                neighbors = self._get_neighbors(grid_idx)
                
                for neighbor_idx in neighbors:
                    dist = np.linalg.norm(candidate - self.points[neighbor_idx])
                    if dist < min_dist:
                        min_dist = dist
                        nearest_idx = neighbor_idx
                
                if nearest_idx is not None and min_dist < self.radius * 1.5:
                    if self._is_valid(self.points[nearest_idx], selected_set):
                        sampled_indices.append(nearest_idx)
                        selected_set.add(nearest_idx)
                        active_list.append(nearest_idx)
                        found = True
            
            if not found:
                active_list.pop(active_idx)
        
        if len(sampled_indices) < target_count and iterations >= max_iterations:
            remaining = list(set(range(self.n)) - selected_set)
            random.shuffle(remaining)
            needed = min(target_count - len(sampled_indices), len(remaining))
            sampled_indices.extend(remaining[:needed])
        
        return sampled_indices

def poisson_disk_sampling(pcd, radius, target_points=None):
    points = np.asarray(pcd.points)
    has_colors = pcd.has_colors()
    has_normals = pcd.has_normals()
    
    if has_colors:
        colors = np.asarray(pcd.colors)
    if has_normals:
        normals = np.asarray(pcd.normals)
    
    original_count = len(points)
    
    if original_count == 0:
        return pcd
    
    if target_points is not None and original_count <= target_points:
        return pcd
    
    print(f"初始化泊松盘采样器...")
    print(f"采样半径: {radius:.6f}")
    print(f"搜索邻居数: 30")
    
    sampler = PoissonDiskSampler(radius, points)
    sampled_indices = sampler.sample(target_points)
    
    sampled_count = len(sampled_indices)
    print(f"初次采样点数: {sampled_count}")
    
    if target_points is not None and sampled_count < target_points:
        print(f"调整采样半径以达到目标点数...")
        remaining_needed = target_points - sampled_count
        current_radius = radius
        
        for _ in range(5):
            new_radius = current_radius * 0.85
            print(f"尝试半径: {new_radius:.6f}")
            
            sampler = PoissonDiskSampler(new_radius, points)
            new_indices = sampler.sample(target_points)
            
            if len(new_indices) >= sampled_count:
                sampled_indices = new_indices
                sampled_count = len(new_indices)
                current_radius = new_radius
            
            if sampled_count >= target_points * 0.95:
                break
        
        if sampled_count < target_points:
            all_indices = set(range(original_count))
            selected = set(sampled_indices)
            remaining = list(all_indices - selected)
            
            if remaining:
                step = max(1, len(remaining) // (target_points - sampled_count))
                additional = remaining[::step][:target_points - sampled_count]
                sampled_indices.extend(additional)
                sampled_count = len(sampled_indices)
    
    sampled_indices = np.array(sampled_indices)
    
    sampled_pcd = o3d.geometry.PointCloud()
    sampled_pcd.points = o3d.utility.Vector3dVector(points[sampled_indices])
    
    if has_colors:
        sampled_pcd.colors = o3d.utility.Vector3dVector(colors[sampled_indices])
    
    if has_normals:
        sampled_pcd.normals = o3d.utility.Vector3dVector(normals[sampled_indices])
    
    return sampled_pcd

def manual_voxel_downsample_with_colors(pcd, voxel_size):
    points = np.asarray(pcd.points)
    has_colors = pcd.has_colors()
    has_normals = pcd.has_normals()
    
    if has_colors:
        colors = np.asarray(pcd.colors)
    
    if has_normals:
        normals = np.asarray(pcd.normals)
    
    voxel_indices = np.floor(points / voxel_size).astype(np.int64)
    
    voxel_dict = {}
    for i, idx in enumerate(voxel_indices):
        idx_tuple = tuple(idx)
        if idx_tuple not in voxel_dict:
            voxel_dict[idx_tuple] = {
                'points': [],
                'colors': [] if has_colors else None,
                'normals': [] if has_normals else None
            }
        voxel_dict[idx_tuple]['points'].append(points[i])
        if has_colors:
            voxel_dict[idx_tuple]['colors'].append(colors[i])
        if has_normals:
            voxel_dict[idx_tuple]['normals'].append(normals[i])
    
    downsampled_points = []
    downsampled_colors = [] if has_colors else None
    downsampled_normals = [] if has_normals else None
    
    for voxel_data in voxel_dict.values():
        voxel_points = np.array(voxel_data['points'])
        center = voxel_points.mean(axis=0)
        downsampled_points.append(center)
        
        if has_colors:
            voxel_colors = np.array(voxel_data['colors'])
            avg_color = voxel_colors.mean(axis=0)
            avg_color = np.clip(avg_color, 0.0, 1.0)
            downsampled_colors.append(avg_color)
        
        if has_normals:
            voxel_normals = np.array(voxel_data['normals'])
            avg_normal = voxel_normals.mean(axis=0)
            norm = np.linalg.norm(avg_normal)
            if norm > 0:
                avg_normal = avg_normal / norm
            downsampled_normals.append(avg_normal)
    
    downsampled_pcd = o3d.geometry.PointCloud()
    downsampled_pcd.points = o3d.utility.Vector3dVector(np.array(downsampled_points))
    
    if has_colors and len(downsampled_colors) > 0:
        downsampled_pcd.colors = o3d.utility.Vector3dVector(np.array(downsampled_colors))
    
    if has_normals and len(downsampled_normals) > 0:
        downsampled_pcd.normals = o3d.utility.Vector3dVector(np.array(downsampled_normals))
    
    return downsampled_pcd

def simplify_pointcloud(input_path, output_path, target_points=None, voxel_size=None, 
                        poisson_radius=None, method='voxel'):
    supported_formats = ['.ply', '.pcd', '.xyz', '.xyzrgb', '.pts', '.csv']
    ext = os.path.splitext(input_path)[1].lower()
    
    if ext not in supported_formats:
        raise ValueError(f"不支持的文件格式: {ext}。支持的格式: {', '.join(supported_formats)}")
    
    print(f"正在读取点云文件: {input_path}")
    pcd = o3d.io.read_point_cloud(input_path)
    
    original_count = len(pcd.points)
    print(f"原始点数: {original_count}")
    
    has_colors = pcd.has_colors()
    has_normals = pcd.has_normals()
    print(f"包含颜色信息: {has_colors}")
    print(f"包含法线信息: {has_normals}")
    print(f"使用算法: {'体素网格下采样' if method == 'voxel' else '泊松盘采样'}")
    
    if has_colors:
        colors = np.asarray(pcd.colors)
        print(f"颜色范围: [{colors.min():.4f}, {colors.max():.4f}]")
        print(f"颜色形状: {colors.shape}")
    
    if original_count == 0:
        raise ValueError("点云文件为空")
    
    if target_points is not None and original_count <= target_points:
        print(f"原始点数 {original_count} 已小于或等于目标点数 {target_points}，无需简化")
        output_pcd = pcd
    else:
        if method == 'voxel':
            if voxel_size is None:
                voxel_size = calculate_voxel_size(pcd, target_points)
            
            print(f"使用体素大小: {voxel_size:.6f}")
            print("正在进行体素网格下采样...")
            
            output_pcd = manual_voxel_downsample_with_colors(pcd, voxel_size)
            
            simplified_count = len(output_pcd.points)
            print(f"简化后点数: {simplified_count}")
            
            if target_points is not None and simplified_count > target_points:
                ratio = target_points / simplified_count
                new_voxel_size = voxel_size / (ratio ** (1/3))
                print(f"点数仍然过多，调整体素大小到: {new_voxel_size:.6f}")
                output_pcd = manual_voxel_downsample_with_colors(pcd, new_voxel_size)
                simplified_count = len(output_pcd.points)
                print(f"调整后点数: {simplified_count}")
        else:
            if poisson_radius is None:
                poisson_radius = calculate_poisson_radius(pcd, target_points)
            
            output_pcd = poisson_disk_sampling(pcd, poisson_radius, target_points)
            simplified_count = len(output_pcd.points)
            print(f"简化后点数: {simplified_count}")
    
    if output_pcd.has_colors():
        out_colors = np.asarray(output_pcd.colors)
        print(f"输出颜色信息: {len(out_colors)} 个点")
        print(f"输出颜色范围: [{out_colors.min():.4f}, {out_colors.max():.4f}]")
    
    print(f"正在保存到: {output_path}")
    
    out_ext = os.path.splitext(output_path)[1].lower()
    
    if out_ext == '.ply':
        write_success = o3d.io.write_point_cloud(
            output_path, 
            output_pcd,
            write_ascii=False,
            compressed=False,
            print_progress=False
        )
    else:
        write_success = o3d.io.write_point_cloud(output_path, output_pcd)
    
    if not write_success:
        raise RuntimeError(f"保存文件失败: {output_path}")
    
    print(f"验证输出文件...")
    verify_pcd = o3d.io.read_point_cloud(output_path)
    print(f"验证: {len(verify_pcd.points)} 点")
    print(f"验证包含颜色: {verify_pcd.has_colors()}")
    if verify_pcd.has_colors():
        verify_colors = np.asarray(verify_pcd.colors)
        print(f"验证颜色范围: [{verify_colors.min():.4f}, {verify_colors.max():.4f}]")
    
    print("完成!")
    
    return original_count, len(output_pcd.points)

def main():
    parser = argparse.ArgumentParser(
        description='点云简化工具 - 支持体素网格下采样和泊松盘采样',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  # 体素网格下采样（默认）
  cloud-simplify input.ply -o output.ply -n 10000
  cloud-simplify input.ply -o output.ply -v 0.05
  
  # 泊松盘采样（分布更均匀）
  cloud-simplify input.ply -o output.ply -n 10000 --method poisson
  cloud-simplify input.ply -o output.ply --method poisson --poisson-radius 0.05
        '''
    )
    
    parser.add_argument('input', help='输入点云文件路径 (.ply, .pcd, .xyz, .xyzrgb 等)')
    parser.add_argument('-o', '--output', required=True, help='输出点云文件路径')
    parser.add_argument('-n', '--num-points', type=int, help='目标点数 (自动计算采样参数)')
    parser.add_argument('-v', '--voxel-size', type=float, help='体素大小 (仅用于voxel方法)')
    parser.add_argument('--poisson-radius', type=float, help='泊松采样半径 (仅用于poisson方法)')
    parser.add_argument('--method', choices=['voxel', 'poisson'], default='voxel',
                        help='采样方法: voxel (体素网格, 默认) 或 poisson (泊松盘采样, 分布更均匀)')
    
    args = parser.parse_args()
    
    if args.num_points is None:
        if args.method == 'voxel' and args.voxel_size is None:
            parser.error('对于voxel方法，必须指定 --num-points (-n) 或 --voxel-size (-v)')
        if args.method == 'poisson' and args.poisson_radius is None:
            parser.error('对于poisson方法，必须指定 --num-points (-n) 或 --poisson-radius')
    
    if not os.path.exists(args.input):
        print(f"错误: 输入文件不存在: {args.input}")
        sys.exit(1)
    
    try:
        original, simplified = simplify_pointcloud(
            args.input, 
            args.output, 
            target_points=args.num_points,
            voxel_size=args.voxel_size,
            poisson_radius=args.poisson_radius,
            method=args.method
        )
        print(f"\n总结: {original} -> {simplified} 点 (减少了 {100 - (simplified/original)*100:.1f}%)")
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
