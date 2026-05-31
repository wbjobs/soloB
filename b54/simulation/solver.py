import numpy as np
from scipy.ndimage import laplace


class FluidSolver:
    def __init__(self, nx=64, ny=64, nz=64, dx=1.0, dt=0.01, nu=0.1, rho=1.0):
        self.nx = nx
        self.ny = ny
        self.nz = nz
        self.dx = dx
        self.dt = dt
        self.nu = nu
        self.rho = rho
        
        self.u = np.zeros((nx, ny, nz))
        self.v = np.zeros((nx, ny, nz))
        self.w = np.zeros((nx, ny, nz))
        self.p = np.zeros((nx, ny, nz))
        
        self.u_prev = np.zeros_like(self.u)
        self.v_prev = np.zeros_like(self.v)
        self.w_prev = np.zeros_like(self.w)
        
        self.init_pipe_flow()
    
    def init_pipe_flow(self):
        center_y = self.ny // 2
        center_z = self.nz // 2
        
        for y in range(self.ny):
            for z in range(self.nz):
                dy = (y - center_y) * self.dx
                dz = (z - center_z) * self.dx
                r2 = dy * dy + dz * dz
                max_r2 = (self.ny // 3 * self.dx) ** 2
                if r2 < max_r2:
                    profile = 1.0 - r2 / max_r2
                    self.u[:, y, z] = 2.0 * profile
    
    def set_boundary_conditions(self):
        self.u[0, :, :] = self.u[1, :, :]
        self.u[-1, :, :] = self.u[-2, :, :]
        self.v[0, :, :] = self.v[-1, :, :] = 0.0
        self.w[0, :, :] = self.w[-1, :, :] = 0.0
        
        self.u[:, 0, :] = self.u[:, -1, :] = 0.0
        self.v[:, 0, :] = self.v[:, 1, :]
        self.v[:, -1, :] = self.v[:, -2, :]
        self.w[:, 0, :] = self.w[:, -1, :] = 0.0
        
        self.u[:, :, 0] = self.u[:, :, -1] = 0.0
        self.v[:, :, 0] = self.v[:, :, -1] = 0.0
        self.w[:, :, 0] = self.w[:, :, 1]
        self.w[:, :, -1] = self.w[:, :, -2]
        
        self.p[0, :, :] = self.p[1, :, :]
        self.p[-1, :, :] = self.p[-2, :, :]
        self.p[:, 0, :] = self.p[:, 1, :]
        self.p[:, -1, :] = self.p[:, -2, :]
        self.p[:, :, 0] = self.p[:, :, 1]
        self.p[:, :, -1] = self.p[:, :, -2]
    
    def advect(self, field, u_vel, v_vel, w_vel):
        result = np.zeros_like(field)
        
        for i in range(1, self.nx - 1):
            for j in range(1, self.ny - 1):
                for k in range(1, self.nz - 1):
                    x = i - u_vel[i, j, k] * self.dt / self.dx
                    y = j - v_vel[i, j, k] * self.dt / self.dx
                    z = k - w_vel[i, j, k] * self.dt / self.dx
                    
                    x = max(1, min(self.nx - 2, x))
                    y = max(1, min(self.ny - 2, y))
                    z = max(1, min(self.nz - 2, z))
                    
                    i0, j0, k0 = int(x), int(y), int(z)
                    i1, j1, k1 = i0 + 1, j0 + 1, k0 + 1
                    
                    s1, s2, s3 = x - i0, y - j0, z - k0
                    
                    v000 = field[i0, j0, k0]
                    v100 = field[i1, j0, k0]
                    v010 = field[i0, j1, k0]
                    v110 = field[i1, j1, k0]
                    v001 = field[i0, j0, k1]
                    v101 = field[i1, j0, k1]
                    v011 = field[i0, j1, k1]
                    v111 = field[i1, j1, k1]
                    
                    v00 = v000 * (1 - s1) + v100 * s1
                    v10 = v010 * (1 - s1) + v110 * s1
                    v01 = v001 * (1 - s1) + v101 * s1
                    v11 = v011 * (1 - s1) + v111 * s1
                    
                    v0 = v00 * (1 - s2) + v10 * s2
                    v1 = v01 * (1 - s2) + v11 * s2
                    
                    result[i, j, k] = v0 * (1 - s3) + v1 * s3
        
        return result
    
    def diffuse(self, field, diff):
        result = np.copy(field)
        
        for _ in range(20):
            lap = laplace(result) / (self.dx * self.dx)
            result = field + self.dt * diff * lap
            self.apply_boundary(result)
        
        return result
    
    def apply_boundary(self, field):
        field[0, :, :] = field[1, :, :]
        field[-1, :, :] = field[-2, :, :]
        field[:, 0, :] = field[:, 1, :]
        field[:, -1, :] = field[:, -2, :]
        field[:, :, 0] = field[:, :, 1]
        field[:, :, -1] = field[:, :, -2]
    
    def compute_divergence(self):
        div = np.zeros_like(self.u)
        
        for i in range(1, self.nx - 1):
            for j in range(1, self.ny - 1):
                for k in range(1, self.nz - 1):
                    div[i, j, k] = (
                        (self.u[i+1, j, k] - self.u[i-1, j, k]) / (2 * self.dx) +
                        (self.v[i, j+1, k] - self.v[i, j-1, k]) / (2 * self.dx) +
                        (self.w[i, j, k+1] - self.w[i, j, k-1]) / (2 * self.dx)
                    )
        
        return div
    
    def pressure_poisson(self, div):
        p_new = np.copy(self.p)
        
        for _ in range(50):
            for i in range(1, self.nx - 1):
                for j in range(1, self.ny - 1):
                    for k in range(1, self.nz - 1):
                        p_new[i, j, k] = (
                            (self.p[i+1, j, k] + self.p[i-1, j, k] +
                             self.p[i, j+1, k] + self.p[i, j-1, k] +
                             self.p[i, j, k+1] + self.p[i, j, k-1] -
                             self.dx * self.dx * div[i, j, k]) / 6.0
                        )
            self.apply_boundary(p_new)
            self.p = p_new.copy()
    
    def project_velocity(self):
        for i in range(1, self.nx - 1):
            for j in range(1, self.ny - 1):
                for k in range(1, self.nz - 1):
                    self.u[i, j, k] -= (self.dt / (2 * self.rho * self.dx)) * (
                        self.p[i+1, j, k] - self.p[i-1, j, k]
                    )
                    self.v[i, j, k] -= (self.dt / (2 * self.rho * self.dx)) * (
                        self.p[i, j+1, k] - self.p[i, j-1, k]
                    )
                    self.w[i, j, k] -= (self.dt / (2 * self.rho * self.dx)) * (
                        self.p[i, j, k+1] - self.p[i, j, k-1]
                    )
        
        self.set_boundary_conditions()
    
    def step(self):
        self.u_prev = self.u.copy()
        self.v_prev = self.v.copy()
        self.w_prev = self.w.copy()
        
        self.u = self.advect(self.u_prev, self.u_prev, self.v_prev, self.w_prev)
        self.v = self.advect(self.v_prev, self.u_prev, self.v_prev, self.w_prev)
        self.w = self.advect(self.w_prev, self.u_prev, self.v_prev, self.w_prev)
        self.set_boundary_conditions()
        
        self.u = self.diffuse(self.u, self.nu)
        self.v = self.diffuse(self.v, self.nu)
        self.w = self.diffuse(self.w, self.nu)
        self.set_boundary_conditions()
        
        div = self.compute_divergence()
        self.pressure_poisson(div)
        self.project_velocity()
    
    def get_state(self):
        return {
            'nx': self.nx,
            'ny': self.ny,
            'nz': self.nz,
            'dx': self.dx,
            'u': self.u.tolist(),
            'v': self.v.tolist(),
            'w': self.w.tolist(),
            'p': self.p.tolist(),
            'velocity_magnitude': np.sqrt(self.u**2 + self.v**2 + self.w**2).tolist()
        }
    
    def get_velocity_at(self, x, y, z):
        return self.u[x, y, z], self.v[x, y, z], self.w[x, y, z]
