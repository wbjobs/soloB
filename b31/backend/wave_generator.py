import numpy as np
import math
from typing import Tuple


class WaveGenerator:
    def __init__(self, grid_size: int = 512):
        self.grid_size = grid_size
        self._min_f = 1e-4
        self._max_f = 2.0
        self._min_s = 0.5
        self._max_s = 10.0
        self._default_direction = 0.0
        
    def jonswap_spectrum(self, f: np.ndarray, U10: float, fetch: float, 
                        f_p: float = None) -> np.ndarray:
        g = 9.81
        
        f_clamped = np.clip(f, self._min_f, self._max_f)
        
        if f_p is None:
            f_p = 0.234 * (g / U10) * (g * fetch / U10**2)**(-0.29)
        
        f_p = np.clip(f_p, 0.02, 1.5)
        
        alpha = 0.076 * (g * fetch / U10**2)**(-0.22)
        gamma = 3.3
        
        f_median = np.median(f_clamped)
        f_max_effective = np.max(f_clamped)
        
        if f_p > f_max_effective * 0.8:
            scale_factor = f_max_effective * 0.7 / f_p
            f_p_effective = f_p * scale_factor
        else:
            f_p_effective = f_p
        
        f_eff = f_clamped
        
        sigma = np.where(f_eff <= f_p_effective, 0.07, 0.09)
        f_ratio = f_eff / f_p_effective
        
        log_exp_term = np.clip(-(f_ratio - 1)**2 / (2 * sigma**2), -50.0, 0.0)
        exp_term = np.exp(log_exp_term)
        gamma_factor = gamma**exp_term
        
        f_p_over_f = f_p_effective / np.maximum(f_eff, self._min_f)
        f_p_over_f_clamped = np.clip(f_p_over_f, 0.0, 3.0)
        log_exp_decay = -1.25 * np.power(f_p_over_f_clamped, 4)
        log_exp_decay = np.clip(log_exp_decay, -20.0, 0.0)
        exp_decay = np.exp(log_exp_decay)
        
        log_f_eff = np.log(f_eff)
        PM_part_log = np.log(alpha * g**2 / (2 * np.pi)**4) - 5 * log_f_eff
        PM_part_log = np.clip(PM_part_log, -50.0, 20.0)
        PM_part = np.exp(PM_part_log)
        
        S_f = PM_part * exp_decay * gamma_factor
        S_f = np.nan_to_num(S_f, nan=0.0, posinf=0.0, neginf=0.0)
        
        f_ratio_actual = f_eff / f_p
        gaussian_envelope = np.exp(-np.clip(f_ratio_actual**2 / (2 * 1.5**2), 0, 20))
        base_spectrum = 1e-8 * gaussian_envelope
        
        if f_p > 0.3:
            high_freq_boost = 1.0 + 10.0 * np.clip((f_p - 0.3) / 1.0, 0, 1)
            f_near_peak = np.abs(f_eff - f_p_effective) < 0.1 * f_p_effective
            S_f = np.where(f_near_peak, S_f * high_freq_boost, S_f)
        
        S_f = np.maximum(S_f, base_spectrum)
        S_f = np.clip(S_f, 0.0, 1e6)
        
        return S_f
    
    def directional_spreading(self, theta: np.ndarray, f: float, f_p: float,
                              main_direction: float = 0.0) -> np.ndarray:
        f_clamped = max(min(f, self._max_f), self._min_f)
        f_p_clamped = max(f_p, 0.01)
        
        if f_clamped <= f_p_clamped:
            s = 6.97 * (f_clamped / f_p_clamped)**4.06
        else:
            s = 9.77 * (f_clamped / f_p_clamped)**(-2.34)
        
        s = np.clip(s, self._min_s, self._max_s)
        
        two_s = 2 * s
        
        try:
            log_2_pow = (two_s - 1) * math.log(2)
            log_gamma_num = 2 * math.lgamma(s + 1)
            log_gamma_den = math.lgamma(two_s + 1)
            
            log_norm = -math.log(math.pi) - log_2_pow + log_gamma_num - log_gamma_den
            norm = math.exp(log_norm)
        except (ValueError, OverflowError):
            norm = 1.0 / math.pi
        
        theta_rel = theta - main_direction
        
        cos_theta = np.cos(theta_rel)
        cos_theta_pos = np.maximum(cos_theta, 0.0)
        
        log_cos = np.log(np.maximum(cos_theta_pos, 1e-10))
        log_G = math.log(max(norm, 1e-10)) + two_s * log_cos
        G = np.exp(log_G)
        
        G = np.nan_to_num(G, nan=0.0, posinf=0.0, neginf=0.0)
        
        return G
    
    def _deg_to_rad(self, degrees: float) -> float:
        return degrees * np.pi / 180.0
    
    def generate_wave_field(self, wind_speed: float, fetch: float, 
                           peak_frequency: float = None, 
                           main_direction: float = 0.0,
                           time: float = 0.0,
                           random_seed: int = None) -> np.ndarray:
        if random_seed is not None:
            np.random.seed(random_seed)
        
        wind_speed = np.clip(wind_speed, 1.0, 50.0)
        fetch = np.clip(fetch, 1000.0, 100000.0)
        main_direction_rad = self._deg_to_rad(np.clip(main_direction, 0.0, 360.0))
        
        N = self.grid_size
        L = 1000.0
        
        kx = np.fft.fftfreq(N, d=L/N) * 2 * np.pi
        ky = np.fft.fftfreq(N, d=L/N) * 2 * np.pi
        kx_grid, ky_grid = np.meshgrid(kx, ky)
        
        k_mag = np.sqrt(kx_grid**2 + ky_grid**2)
        k_mag = np.where(k_mag < 1e-10, 1e-10, k_mag)
        k_mag = np.clip(k_mag, 1e-6, 100.0)
        
        theta = np.arctan2(ky_grid, kx_grid)
        
        g = 9.81
        omega = np.sqrt(g * k_mag)
        f = omega / (2 * np.pi)
        
        if peak_frequency is None:
            f_p = 0.234 * (g / wind_speed) * (g * fetch / wind_speed**2)**(-0.29)
        else:
            f_p = peak_frequency
        
        f_p = np.clip(f_p, 0.01, 2.0)
        
        S_f = self.jonswap_spectrum(f, wind_speed, fetch, f_p)
        S_f = np.nan_to_num(S_f, nan=0.0, posinf=0.0, neginf=0.0)
        
        G = np.zeros_like(f)
        for i in range(f.shape[0]):
            for j in range(f.shape[1]):
                try:
                    g_val = self.directional_spreading(
                        theta[i, j], f[i, j], f_p, main_direction_rad
                    )
                    G[i, j] = g_val if np.isfinite(g_val) else 0.0
                except:
                    G[i, j] = 0.0
        
        G = np.nan_to_num(G, nan=0.0, posinf=0.0, neginf=0.0)
        
        dk = 2 * np.pi / L
        dkx = dky = dk
        
        amplitude_squared = 2 * S_f * G * dkx * dky
        amplitude_squared = np.maximum(amplitude_squared, 0.0)
        amplitude = np.sqrt(amplitude_squared)
        amplitude = np.nan_to_num(amplitude, nan=0.0, posinf=0.0, neginf=0.0)
        
        phase = np.random.uniform(0, 2 * np.pi, (N, N))
        
        omega_clamped = np.clip(omega, 0.0, 100.0)
        phase_term = phase + omega_clamped * time
        
        cos_part = amplitude * np.cos(phase_term)
        sin_part = amplitude * np.sin(phase_term)
        height_fft = cos_part + 1j * sin_part
        
        height_fft = np.nan_to_num(height_fft, nan=0.0, posinf=0.0, neginf=0.0)
        
        height_field = np.real(np.fft.ifft2(height_fft))
        
        height_field = np.nan_to_num(height_field, nan=0.0, posinf=10.0, neginf=-10.0)
        
        std_val = height_field.std()
        if std_val < 1e-8 or not np.isfinite(std_val):
            std_val = 1.0
        
        mean_val = height_field.mean()
        if not np.isfinite(mean_val):
            mean_val = 0.0
        
        height_field = (height_field - mean_val) / std_val
        height_field = np.clip(height_field, -5.0, 5.0)
        height_field = height_field * 2.0
        
        return height_field.astype(np.float32)


if __name__ == "__main__":
    generator = WaveGenerator(grid_size=512)
    wave = generator.generate_wave_field(
        wind_speed=10.0,
        fetch=10000.0,
        peak_frequency=0.1,
        time=0.0
    )
    print(f"Generated wave field shape: {wave.shape}")
    print(f"Min: {wave.min()}, Max: {wave.max()}, Mean: {wave.mean()}")
