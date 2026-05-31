use super::vec3::Vec3;
use super::ray::Ray;

pub struct Camera {
    pub origin: Vec3,
    pub lower_left_corner: Vec3,
    pub horizontal: Vec3,
    pub vertical: Vec3,
    pub lens_radius: f32,
    pub u: Vec3,
    pub v: Vec3,
    pub w: Vec3,
}

impl Camera {
    pub fn new(look_from: Vec3, look_at: Vec3, vup: Vec3, vfov: f32, aspect: f32, aperture: f32, focus_dist: f32) -> Self {
        let theta = vfov.to_radians();
        let h = (theta / 2.0).tan();
        let viewport_height = 2.0 * h;
        let viewport_width = aspect * viewport_height;

        let w = (look_from - look_at).normalize();
        let u = vup.cross(&w).normalize();
        let v = w.cross(&u);

        let origin = look_from;
        let horizontal = u * viewport_width * focus_dist;
        let vertical = v * viewport_height * focus_dist;
        let lower_left_corner = origin - horizontal * 0.5 - vertical * 0.5 - w * focus_dist;
        let lens_radius = aperture / 2.0;

        Camera {
            origin,
            lower_left_corner,
            horizontal,
            vertical,
            lens_radius,
            u,
            v,
            w,
        }
    }

    pub fn default(resolution: (u32, u32)) -> Self {
        let aspect = resolution.0 as f32 / resolution.1 as f32;
        Camera::new(
            Vec3::new(0.0, 0.0, 5.0),
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
            45.0,
            aspect,
            0.0,
            5.0,
        )
    }

    pub fn get_ray(&self, s: f32, t: f32) -> Ray {
        let rd = self.random_in_unit_disk() * self.lens_radius;
        let offset = self.u * rd.x + self.v * rd.y;

        Ray::new(
            self.origin + offset,
            self.lower_left_corner + self.horizontal * s + self.vertical * t - self.origin - offset,
        )
    }

    fn random_in_unit_disk(&self) -> Vec3 {
        use rand::Rng;
        let mut rng = rand::thread_rng();

        loop {
            let p = Vec3::new(
                rng.gen::<f32>() * 2.0 - 1.0,
                rng.gen::<f32>() * 2.0 - 1.0,
                0.0,
            );
            if p.squared_length() < 1.0 {
                return p;
            }
        }
    }
}
