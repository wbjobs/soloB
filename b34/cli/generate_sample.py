#!/usr/bin/env python3
import numpy as np
import open3d as o3d
import os

def generate_colored_sphere(num_points=50000):
    phi = np.random.uniform(0, np.pi, num_points)
    theta = np.random.uniform(0, 2 * np.pi, num_points)
    
    x = np.sin(phi) * np.cos(theta)
    y = np.sin(phi) * np.sin(theta)
    z = np.cos(phi)
    
    colors = np.stack([
        (x + 1) / 2,
        (y + 1) / 2,
        (z + 1) / 2
    ], axis=1)
    
    colors = np.clip(colors, 0.0, 1.0)
    
    return np.stack([x, y, z], axis=1), colors

def generate_noisy_plane(num_points=100000):
    x = np.random.uniform(-5, 5, num_points)
    y = np.random.uniform(-5, 5, num_points)
    z = np.sin(x * 0.5) * np.cos(y * 0.5) + np.random.normal(0, 0.1, num_points)
    
    colors = np.stack([
        (x + 5) / 10,
        (z + 2) / 4,
        np.full(num_points, 0.3)
    ], axis=1)
    
    colors = np.clip(colors, 0.0, 1.0)
    
    return np.stack([x, y, z], axis=1), colors

def main():
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
    os.makedirs(output_dir, exist_ok=True)
    
    print("生成彩色球体点云 (50,000 点)...")
    sphere_points, sphere_colors = generate_colored_sphere(50000)
    sphere_pcd = o3d.geometry.PointCloud()
    sphere_pcd.points = o3d.utility.Vector3dVector(sphere_points)
    sphere_pcd.colors = o3d.utility.Vector3dVector(sphere_colors)
    
    print(f"  点数: {len(sphere_pcd.points)}")
    print(f"  有颜色: {sphere_pcd.has_colors()}")
    print(f"  颜色范围: [{sphere_colors.min():.4f}, {sphere_colors.max():.4f}]")
    
    sphere_path = os.path.join(output_dir, 'sphere_sample.ply')
    o3d.io.write_point_cloud(sphere_path, sphere_pcd, write_ascii=False)
    print(f"  已保存: {sphere_path}")
    
    verify = o3d.io.read_point_cloud(sphere_path)
    print(f"  验证 - 有颜色: {verify.has_colors()}")
    if verify.has_colors():
        vc = np.asarray(verify.colors)
        print(f"  验证 - 颜色范围: [{vc.min():.4f}, {vc.max():.4f}]")
    
    print("\n生成彩色噪波平面点云 (100,000 点)...")
    plane_points, plane_colors = generate_noisy_plane(100000)
    plane_pcd = o3d.geometry.PointCloud()
    plane_pcd.points = o3d.utility.Vector3dVector(plane_points)
    plane_pcd.colors = o3d.utility.Vector3dVector(plane_colors)
    
    print(f"  点数: {len(plane_pcd.points)}")
    print(f"  有颜色: {plane_pcd.has_colors()}")
    print(f"  颜色范围: [{plane_colors.min():.4f}, {plane_colors.max():.4f}]")
    
    plane_path = os.path.join(output_dir, 'plane_sample.ply')
    o3d.io.write_point_cloud(plane_path, plane_pcd, write_ascii=False)
    print(f"  已保存: {plane_path}")
    
    verify = o3d.io.read_point_cloud(plane_path)
    print(f"  验证 - 有颜色: {verify.has_colors()}")
    if verify.has_colors():
        vc = np.asarray(verify.colors)
        print(f"  验证 - 颜色范围: [{vc.min():.4f}, {vc.max():.4f}]")
    
    print("\n示例点云文件生成完成!")
    print(f"\n测试命令:")
    print(f"  python cli/cloud_simplify.py models/sphere_sample.ply -o outputs/test_sphere.ply -n 5000")

if __name__ == '__main__':
    main()
