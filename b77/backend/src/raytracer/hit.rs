use super::vec3::Vec3;
use super::ray::Ray;

#[derive(Debug, Clone, Copy)]
pub struct HitRecord {
    pub t: f32,
    pub point: Vec3,
    pub normal: Vec3,
    pub uv: (f32, f32),
    pub triangle_index: usize,
}

impl HitRecord {
    pub fn new() -> Self {
        HitRecord {
            t: 0.0,
            point: Vec3::zero(),
            normal: Vec3::zero(),
            uv: (0.0, 0.0),
            triangle_index: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Triangle {
    pub vertices: [Vec3; 3],
    pub normals: Option<[Vec3; 3]>,
    pub uvs: Option<[(f32, f32); 3]>,
    pub normal: Vec3,
}

impl Triangle {
    pub fn new(vertices: [Vec3; 3]) -> Self {
        let edge1 = vertices[1] - vertices[0];
        let edge2 = vertices[2] - vertices[0];
        let normal = edge1.cross(&edge2).normalize();

        Triangle {
            vertices,
            normals: None,
            uvs: None,
            normal,
        }
    }

    pub fn with_normals(vertices: [Vec3; 3], normals: [Vec3; 3]) -> Self {
        Triangle {
            vertices,
            normals: Some(normals),
            uvs: None,
            normal: normals[0].normalize(),
        }
    }

    pub fn with_uvs(vertices: [Vec3; 3], uvs: [(f32, f32); 3]) -> Self {
        let edge1 = vertices[1] - vertices[0];
        let edge2 = vertices[2] - vertices[0];
        let normal = edge1.cross(&edge2).normalize();

        Triangle {
            vertices,
            normals: None,
            uvs: Some(uvs),
            normal,
        }
    }

    pub fn intersect(&self, ray: &Ray, t_min: f32, t_max: f32) -> Option<HitRecord> {
        let edge1 = self.vertices[1] - self.vertices[0];
        let edge2 = self.vertices[2] - self.vertices[0];
        let h = ray.direction.cross(&edge2);
        let a = edge1.dot(&h);

        if a > -0.0001 && a < 0.0001 {
            return None;
        }

        let f = 1.0 / a;
        let s = ray.origin - self.vertices[0];
        let u = f * s.dot(&h);

        if u < 0.0 || u > 1.0 {
            return None;
        }

        let q = s.cross(&edge1);
        let v = f * ray.direction.dot(&q);

        if v < 0.0 || u + v > 1.0 {
            return None;
        }

        let t = f * edge2.dot(&q);

        if t > t_min && t < t_max {
            let point = ray.at(t);
            let normal = self.get_interpolated_normal(u, v);
            let uv = self.get_interpolated_uv(u, v);

            Some(HitRecord {
                t,
                point,
                normal,
                uv,
                triangle_index: 0,
            })
        } else {
            None
        }
    }

    fn get_interpolated_normal(&self, u: f32, v: f32) -> Vec3 {
        if let Some(normals) = &self.normals {
            let w = 1.0 - u - v;
            (normals[0] * w + normals[1] * u + normals[2] * v).normalize()
        } else {
            self.normal
        }
    }

    fn get_interpolated_uv(&self, u: f32, v: f32) -> (f32, f32) {
        if let Some(uvs) = &self.uvs {
            let w = 1.0 - u - v;
            (
                uvs[0].0 * w + uvs[1].0 * u + uvs[2].0 * v,
                uvs[0].1 * w + uvs[1].1 * u + uvs[2].1 * v,
            )
        } else {
            (u, v)
        }
    }
}

#[derive(Debug, Clone)]
pub struct Mesh {
    pub triangles: Vec<Triangle>,
}

impl Mesh {
    pub fn new() -> Self {
        Mesh { triangles: Vec::new() }
    }

    pub fn add_triangle(&mut self, triangle: Triangle) {
        self.triangles.push(triangle);
    }

    pub fn intersect(&self, ray: &Ray, t_min: f32, t_max: f32) -> Option<HitRecord> {
        let mut closest = t_max;
        let mut hit_record: Option<HitRecord> = None;

        for (i, triangle) in self.triangles.iter().enumerate() {
            if let Some(mut hit) = triangle.intersect(ray, t_min, closest) {
                hit.triangle_index = i;
                closest = hit.t;
                hit_record = Some(hit);
            }
        }

        hit_record
    }
}
