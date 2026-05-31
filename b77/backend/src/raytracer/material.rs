use super::vec3::Vec3;
use super::ray::Ray;
use super::hit::HitRecord;

#[derive(Debug, Clone, Copy)]
pub enum MaterialType {
    Lambertian,
    Metal,
    Dielectric,
    Emissive,
}

#[derive(Debug, Clone, Copy)]
pub struct Material {
    pub albedo: Vec3,
    pub roughness: f32,
    pub ior: f32,
    pub emissive: Vec3,
    pub material_type: MaterialType,
}

impl Material {
    pub fn lambertian(albedo: Vec3) -> Self {
        Material {
            albedo,
            roughness: 0.0,
            ior: 1.0,
            emissive: Vec3::zero(),
            material_type: MaterialType::Lambertian,
        }
    }

    pub fn metal(albedo: Vec3, roughness: f32) -> Self {
        Material {
            albedo,
            roughness,
            ior: 1.0,
            emissive: Vec3::zero(),
            material_type: MaterialType::Metal,
        }
    }

    pub fn dielectric(ior: f32) -> Self {
        Material {
            albedo: Vec3::one(),
            roughness: 0.0,
            ior,
            emissive: Vec3::zero(),
            material_type: MaterialType::Dielectric,
        }
    }

    pub fn emissive(color: Vec3) -> Self {
        Material {
            albedo: Vec3::zero(),
            roughness: 0.0,
            ior: 1.0,
            emissive: color,
            material_type: MaterialType::Emissive,
        }
    }

    pub fn scatter(&self, ray: &Ray, hit: &HitRecord) -> Option<(Vec3, Ray)> {
        match self.material_type {
            MaterialType::Lambertian => {
                let mut scatter_direction = hit.normal + random_unit_vector();
                if scatter_direction.squared_length() < 0.0001 {
                    scatter_direction = hit.normal;
                }
                let scattered = Ray::with_depth(hit.point, scatter_direction, ray.depth + 1);
                Some((self.albedo, scattered))
            }
            MaterialType::Metal => {
                let reflected = ray.direction.reflect(&hit.normal);
                let scattered = Ray::with_depth(
                    hit.point,
                    reflected + random_in_unit_sphere() * self.roughness,
                    ray.depth + 1,
                );
                if scattered.direction.dot(&hit.normal) > 0.0 {
                    Some((self.albedo, scattered))
                } else {
                    None
                }
            }
            MaterialType::Dielectric => {
                let refraction_ratio = if hit.normal.dot(&ray.direction) < 0.0 {
                    1.0 / self.ior
                } else {
                    self.ior
                };

                let unit_direction = ray.direction.normalize();
                let cos_theta = (-unit_direction).dot(&hit.normal).min(1.0);
                let sin_theta = (1.0 - cos_theta * cos_theta).sqrt();

                let cannot_refract = refraction_ratio * sin_theta > 1.0;
                let direction = if cannot_refract || reflectance(cos_theta, refraction_ratio) > rand::random::<f32>() {
                    unit_direction.reflect(&hit.normal)
                } else {
                    refract(&unit_direction, &hit.normal, refraction_ratio)
                };

                let scattered = Ray::with_depth(hit.point, direction, ray.depth + 1);
                Some((Vec3::one(), scattered))
            }
            MaterialType::Emissive => {
                None
            }
        }
    }

    pub fn emitted(&self) -> Vec3 {
        self.emissive
    }
}

fn random_in_unit_sphere() -> Vec3 {
    use rand::Rng;
    let mut rng = rand::thread_rng();

    loop {
        let p = Vec3::new(
            rng.gen::<f32>() * 2.0 - 1.0,
            rng.gen::<f32>() * 2.0 - 1.0,
            rng.gen::<f32>() * 2.0 - 1.0,
        );
        if p.squared_length() < 1.0 {
            return p;
        }
    }
}

fn random_unit_vector() -> Vec3 {
    random_in_unit_sphere().normalize()
}

fn refract(uv: &Vec3, n: &Vec3, etai_over_etat: f32) -> Vec3 {
    let cos_theta = (-*uv).dot(n).min(1.0);
    let r_out_perp = (*uv + *n * cos_theta) * etai_over_etat;
    let r_out_parallel = *n * -(1.0 - r_out_perp.squared_length()).abs().sqrt();
    r_out_perp + r_out_parallel
}

fn reflectance(cosine: f32, ref_idx: f32) -> f32 {
    let r0 = ((1.0 - ref_idx) / (1.0 + ref_idx)).powi(2);
    r0 + (1.0 - r0) * (1.0 - cosine).powi(5)
}
