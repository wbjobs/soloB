use super::vec3::Vec3;
use super::hit::{Mesh, Triangle};
use std::io::{self, BufRead};

pub struct ObjLoader {
    pub vertices: Vec<Vec3>,
    pub normals: Vec<Vec3>,
    pub uvs: Vec<(f32, f32)>,
    pub faces: Vec<Vec<(usize, Option<usize>, Option<usize>)>>,
}

impl ObjLoader {
    pub fn new() -> Self {
        ObjLoader {
            vertices: Vec::new(),
            normals: Vec::new(),
            uvs: Vec::new(),
            faces: Vec::new(),
        }
    }

    pub fn with_capacity(vertices: usize, normals: usize, uvs: usize, faces: usize) -> Self {
        ObjLoader {
            vertices: Vec::with_capacity(vertices),
            normals: Vec::with_capacity(normals),
            uvs: Vec::with_capacity(uvs),
            faces: Vec::with_capacity(faces),
        }
    }

    pub fn parse(&mut self, content: &str) -> Result<(), String> {
        self.parse_stream(content.as_bytes())
    }

    pub fn parse_stream<R: BufRead>(&mut self, reader: R) -> Result<(), String> {
        let mut line = String::with_capacity(256);
        let mut reader = io::BufReader::new(reader);

        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    self.parse_line(trimmed)?;
                }
                Err(e) => return Err(format!("Failed to read line: {}", e)),
            }
        }

        Ok(())
    }

    fn parse_line(&mut self, line: &str) -> Result<(), String> {
        let mut parts = line.split_whitespace();
        let command = parts.next().unwrap_or("");

        match command {
            "v" => {
                let x = parts.next().and_then(|s| s.parse::<f32>().ok()).ok_or("Invalid vertex x")?;
                let y = parts.next().and_then(|s| s.parse::<f32>().ok()).ok_or("Invalid vertex y")?;
                let z = parts.next().and_then(|s| s.parse::<f32>().ok()).ok_or("Invalid vertex z")?;
                self.vertices.push(Vec3::new(x, y, z));
            }
            "vn" => {
                let x = parts.next().and_then(|s| s.parse::<f32>().ok()).ok_or("Invalid normal x")?;
                let y = parts.next().and_then(|s| s.parse::<f32>().ok()).ok_or("Invalid normal y")?;
                let z = parts.next().and_then(|s| s.parse::<f32>().ok()).ok_or("Invalid normal z")?;
                self.normals.push(Vec3::new(x, y, z).normalize());
            }
            "vt" => {
                let u = parts.next().and_then(|s| s.parse::<f32>().ok()).ok_or("Invalid uv u")?;
                let v = parts.next().and_then(|s| s.parse::<f32>().ok()).ok_or("Invalid uv v")?;
                self.uvs.push((u, v));
            }
            "f" => {
                let mut face = Vec::with_capacity(4);
                for part in parts {
                    let mut indices = part.split('/');
                    let v_idx = indices.next().and_then(|s| s.parse::<usize>().ok()).ok_or("Invalid face vertex index")? - 1;
                    let vt_idx = indices.next().and_then(|s| if s.is_empty() { None } else { s.parse::<usize>().ok() }).map(|i| i - 1);
                    let vn_idx = indices.next().and_then(|s| if s.is_empty() { None } else { s.parse::<usize>().ok() }).map(|i| i - 1);
                    face.push((v_idx, vt_idx, vn_idx));
                }
                if face.len() >= 3 {
                    self.faces.push(face);
                }
            }
            _ => {}
        }

        Ok(())
    }

    pub fn center_and_scale(&mut self, scale: f32) {
        if self.vertices.is_empty() {
            return;
        }

        let mut min = Vec3::new(f32::MAX, f32::MAX, f32::MAX);
        let mut max = Vec3::new(f32::MIN, f32::MIN, f32::MIN);

        for v in &self.vertices {
            min.x = min.x.min(v.x);
            min.y = min.y.min(v.y);
            min.z = min.z.min(v.z);
            max.x = max.x.max(v.x);
            max.y = max.y.max(v.y);
            max.z = max.z.max(v.z);
        }

        let center = Vec3::new(
            (min.x + max.x) / 2.0,
            (min.y + max.y) / 2.0,
            (min.z + max.z) / 2.0,
        );

        let size = (max.x - min.x).max(max.y - min.y).max(max.z - min.z);
        let scale_factor = if size > 0.0 { scale / size } else { 1.0 };

        for v in &mut self.vertices {
            v.x = (v.x - center.x) * scale_factor;
            v.y = (v.y - center.y) * scale_factor;
            v.z = (v.z - center.z) * scale_factor;
        }
    }

    pub fn to_mesh(&self) -> Mesh {
        let mut mesh = Mesh::new();

        for face in &self.faces {
            if face.len() == 3 {
                self.add_triangle_to_mesh(&mut mesh, face);
            } else if face.len() > 3 {
                for i in 1..face.len() - 1 {
                    let triangle_face = vec![face[0], face[i], face[i + 1]];
                    self.add_triangle_to_mesh(&mut mesh, &triangle_face);
                }
            }
        }

        mesh
    }

    fn add_triangle_to_mesh(&self, mesh: &mut Mesh, face: &Vec<(usize, Option<usize>, Option<usize>)>) {
        if face.len() != 3 {
            return;
        }

        let mut vertices = [Vec3::zero(); 3];
        let mut normals = [Vec3::zero(); 3];
        let mut uvs = [(0.0, 0.0); 3];
        let mut has_normals = true;
        let mut has_uvs = true;

        for i in 0..3 {
            if let Some(v) = self.vertices.get(face[i].0) {
                vertices[i] = *v;
            }

            if let Some(n_idx) = face[i].2 {
                if let Some(n) = self.normals.get(n_idx) {
                    normals[i] = *n;
                } else {
                    has_normals = false;
                }
            } else {
                has_normals = false;
            }

            if let Some(t_idx) = face[i].1 {
                if let Some(t) = self.uvs.get(t_idx) {
                    uvs[i] = *t;
                } else {
                    has_uvs = false;
                }
            } else {
                has_uvs = false;
            }
        }

        let triangle = if has_normals && has_uvs {
            let mut tri = Triangle::with_uvs(vertices, uvs);
            tri.normals = Some(normals);
            tri
        } else if has_normals {
            Triangle::with_normals(vertices, normals)
        } else if has_uvs {
            Triangle::with_uvs(vertices, uvs)
        } else {
            Triangle::new(vertices)
        };

        mesh.add_triangle(triangle);
    }
}

impl Default for ObjLoader {
    fn default() -> Self {
        Self::new()
    }
}
