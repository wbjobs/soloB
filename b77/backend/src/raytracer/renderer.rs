use super::vec3::Vec3;
use super::ray::Ray;
use super::hit::*;
use super::camera::Camera;
use super::material::*;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderParams {
    pub samples: u32,
    pub max_depth: u32,
    pub light_position: Vec3,
    pub resolution: (u32, u32),
    pub adaptive_sampling: bool,
    pub edge_threshold: f32,
    pub max_samples: u32,
}

pub struct Renderer {
    pub mesh: Mesh,
    pub params: RenderParams,
    pub camera: Camera,
    pub material: Material,
}

impl Renderer {
    pub fn new(mesh: Mesh, params: RenderParams) -> Self {
        let camera = Camera::default(params.resolution);
        let material = Material::lambertian(Vec3::new(0.8, 0.8, 0.8));

        Renderer {
            mesh,
            params,
            camera,
            material,
        }
    }

    pub fn render_tile(&self, start_x: u32, start_y: u32, tile_width: u32, tile_height: u32) -> (Vec<u8>, u64) {
        let (width, height) = self.params.resolution;
        let mut pixels = Vec::with_capacity((tile_width * tile_height * 4) as usize);
        let mut total_samples = 0u64;

        let mut color_buffer: Vec<Vec3> = vec![Vec3::zero(); (tile_width * tile_height) as usize];

        let samples = if self.params.adaptive_sampling {
            (self.params.samples / 2).max(1)
        } else {
            self.params.samples
        };

        for y in 0..tile_height {
            for x in 0..tile_width {
                let mut color = Vec3::zero();
                let px = start_x + x;
                let py = start_y + y;

                for _ in 0..samples {
                    let u = (px as f32 + rand::random::<f32>()) / width as f32;
                    let v = (py as f32 + rand::random::<f32>()) / height as f32;
                    let ray = self.camera.get_ray(u, v);
                    color = color + self.trace_ray(&ray, 0);
                }

                color = color / samples as f32;
                color_buffer[(y * tile_width + x) as usize] = color;
                total_samples += samples as u64;
            }
        }

        if self.params.adaptive_sampling {
            let additional_samples = self.detect_edges_and_adjust(
                &mut color_buffer,
                start_x,
                start_y,
                tile_width,
                tile_height,
                &mut total_samples,
            );

            for (i, color) in color_buffer.iter_mut().enumerate() {
                let samples = additional_samples[i];
                if samples > 0 {
                    let x = (i as u32 % tile_width) + start_x;
                    let y = (i as u32 / tile_width) + start_y;

                    for _ in 0..samples {
                        let u = (x as f32 + rand::random::<f32>()) / width as f32;
                        let v = (y as f32 + rand::random::<f32>()) / height as f32;
                        let ray = self.camera.get_ray(u, v);
                        *color = *color + self.trace_ray(&ray, 0);
                    }

                    let total = samples + self.params.samples / 2;
                    *color = *color / total as f32;
                }
            }
        }

        for color in color_buffer {
            let r = (color.x.clamp(0.0, 1.0) * 255.0) as u8;
            let g = (color.y.clamp(0.0, 1.0) * 255.0) as u8;
            let b = (color.z.clamp(0.0, 1.0) * 255.0) as u8;

            pixels.push(r);
            pixels.push(g);
            pixels.push(b);
            pixels.push(255);
        }

        (pixels, total_samples)
    }

    fn detect_edges_and_adjust(
        &self,
        color_buffer: &[Vec3],
        start_x: u32,
        start_y: u32,
        tile_width: u32,
        tile_height: u32,
        total_samples: &mut u64,
    ) -> Vec<u32> {
        let mut additional_samples = vec![0u32; (tile_width * tile_height) as usize];

        for y in 0..tile_height {
            for x in 0..tile_width {
                let idx = (y * tile_width + x) as usize;
                let center_color = color_buffer[idx];

                let mut variance = 0.0f32;
                let mut neighbors = 0;

                for dy in -1..=1 {
                    for dx in -1..=1 {
                        if dx == 0 && dy == 0 {
                            continue;
                        }

                        let nx = x as i32 + dx;
                        let ny = y as i32 + dy;

                        if nx >= 0 && nx < tile_width as i32 && ny >= 0 && ny < tile_height as i32 {
                            let nidx = (ny * tile_width as i32 + nx) as usize;
                            let neighbor_color = color_buffer[nidx];

                            let diff = (center_color.x - neighbor_color.x).abs()
                                + (center_color.y - neighbor_color.y).abs()
                                + (center_color.z - neighbor_color.z).abs();

                            variance += diff;
                            neighbors += 1;
                        }
                    }
                }

                if neighbors > 0 {
                    variance /= neighbors as f32;
                }

                if variance > self.params.edge_threshold {
                    let factor = (variance / self.params.edge_threshold).min(3.0);
                    let extra_samples = ((self.params.max_samples - self.params.samples / 2) as f32 * (factor - 1.0) / 2.0) as u32;
                    additional_samples[idx] = extra_samples.min(self.params.max_samples);
                    *total_samples += additional_samples[idx] as u64;
                }
            }
        }

        additional_samples
    }

    fn trace_ray(&self, ray: &Ray, depth: u32) -> Vec3 {
        if depth >= self.params.max_depth {
            return self.sky_color(ray);
        }

        if let Some(hit) = self.mesh.intersect(ray, 0.001, f32::MAX) {
            let emitted = self.material.emitted();

            if let Some((attenuation, scattered)) = self.material.scatter(ray, &hit) {
                let direct = self.direct_lighting(&hit);
                let indirect = self.trace_ray(&scattered, depth + 1);
                emitted + attenuation * (direct + indirect * 0.5)
            } else {
                emitted
            }
        } else {
            self.sky_color(ray)
        }
    }

    fn direct_lighting(&self, hit: &HitRecord) -> Vec3 {
        let light_dir = (self.params.light_position - hit.point).normalize();
        let shadow_ray = Ray::new(hit.point + hit.normal * 0.001, light_dir);

        if self.mesh.intersect(&shadow_ray, 0.001, f32::MAX).is_some() {
            Vec3::new(0.1, 0.1, 0.1)
        } else {
            let diffuse = hit.normal.dot(&light_dir).max(0.0);
            Vec3::new(1.0, 1.0, 1.0) * diffuse * 0.8 + Vec3::new(0.1, 0.1, 0.1)
        }
    }

    fn sky_color(&self, ray: &Ray) -> Vec3 {
        let t = 0.5 * (ray.direction.normalize().y + 1.0);
        Vec3::new(1.0, 1.0, 1.0) * (1.0 - t) + Vec3::new(0.5, 0.7, 1.0) * t
    }

    pub fn debug_pixel(&self, x: u32, y: u32) -> DebugPixelData {
        let (width, height) = self.params.resolution;
        let u = x as f32 / width as f32;
        let v = y as f32 / height as f32;
        let ray = self.camera.get_ray(u, v);

        let mut ray_tree = Vec::new();
        let mut intersections = Vec::new();
        let mut shading_values = Vec::new();

        self.collect_debug_info(&ray, 0, &mut ray_tree, &mut intersections, &mut shading_values);

        DebugPixelData {
            x,
            y,
            ray_tree,
            intersections,
            shading_values,
        }
    }

    fn collect_debug_info(
        &self,
        ray: &Ray,
        depth: u32,
        ray_tree: &mut Vec<DebugRay>,
        intersections: &mut Vec<DebugIntersection>,
        shading_values: &mut Vec<DebugShading>,
    ) {
        if depth >= self.params.max_depth {
            return;
        }

        let debug_ray = DebugRay {
            depth,
            origin: ray.origin,
            direction: ray.direction,
            color: self.sky_color(ray),
        };
        ray_tree.push(debug_ray);

        if let Some(hit) = self.mesh.intersect(ray, 0.001, f32::MAX) {
            let intersection = DebugIntersection {
                triangle_index: hit.triangle_index,
                point: hit.point,
                normal: hit.normal,
                uv: hit.uv,
            };
            intersections.push(intersection);

            let direct = self.direct_lighting(&hit);
            let shading = DebugShading {
                step: "direct_lighting".to_string(),
                color: direct,
                contribution: 0.8,
                description: "Direct lighting from light source".to_string(),
            };
            shading_values.push(shading);

            if let Some((attenuation, scattered)) = self.material.scatter(ray, &hit) {
                let shading = DebugShading {
                    step: "scatter".to_string(),
                    color: attenuation,
                    contribution: 0.5,
                    description: "Material scattering".to_string(),
                };
                shading_values.push(shading);

                self.collect_debug_info(&scattered, depth + 1, ray_tree, intersections, shading_values);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DebugPixelData {
    pub x: u32,
    pub y: u32,
    pub ray_tree: Vec<DebugRay>,
    pub intersections: Vec<DebugIntersection>,
    pub shading_values: Vec<DebugShading>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DebugRay {
    pub depth: u32,
    pub origin: Vec3,
    pub direction: Vec3,
    pub color: Vec3,
}

#[derive(Debug, Clone, Serialize)]
pub struct DebugIntersection {
    pub triangle_index: usize,
    pub point: Vec3,
    pub normal: Vec3,
    pub uv: (f32, f32),
}

#[derive(Debug, Clone, Serialize)]
pub struct DebugShading {
    pub step: String,
    pub color: Vec3,
    pub contribution: f32,
    pub description: String,
}
