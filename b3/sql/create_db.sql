-- 创建数据库（请先手动执行）
CREATE DATABASE raster_db;

-- 连接到 raster_db 后执行
\c raster_db

-- 启用 PostGIS 扩展
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- 验证扩展
SELECT PostGIS_Version();
