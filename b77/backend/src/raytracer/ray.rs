use super::vec3::Vec3;

#[derive(Debug, Clone, Copy)]
pub struct Ray {
    pub origin: Vec3,
    pub direction: Vec3,
    pub depth: u32,
}

impl Ray {
    pub fn new(origin: Vec3, direction: Vec3) -> Self {
        Ray {
            origin,
            direction: direction.normalize(),
            depth: 0,
        }
    }

    pub fn with_depth(origin: Vec3, direction: Vec3, depth: u32) -> Self {
        Ray {
            origin,
            direction: direction.normalize(),
            depth,
        }
    }

    pub fn at(&self, t: f32) -> Vec3 {
        Vec3::new(
            self.origin.x + t * self.direction.x,
            self.origin.y + t * self.direction.y,
            self.origin.z + t * self.direction.z,
        )
    }
}
