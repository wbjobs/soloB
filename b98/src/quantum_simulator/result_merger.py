import numpy as np
from typing import List, Dict, Tuple, Optional
from .density_matrix import DensityMatrixSimulator


class MaximumLikelihoodEstimator:
    def __init__(self, total_qubits: int):
        self.total_qubits = total_qubits
        self.dim = 2 ** total_qubits

    def estimate(self, subcircuit_results: List[Dict], partitions: List[List[int]]) -> np.ndarray:
        rho = self._tensor_product_merge(subcircuit_results, partitions)
        rho = self._make_positive_semidefinite(rho)
        return self._normalize(rho)

    def _tensor_product_merge(self, subcircuit_results: List[Dict], partitions: List[List[int]]) -> np.ndarray:
        qubit_states = {}
        
        for result in subcircuit_results:
            if result.get('density_matrix') is None:
                continue
            
            qubits = result['qubits']
            dm = result['density_matrix']
            k = len(qubits)
            
            for i, q in enumerate(qubits):
                if k == 1:
                    qubit_states[q] = dm
                else:
                    trace_out = [j for j in range(k) if j != i]
                    sim = DensityMatrixSimulator(k)
                    sim.set_density_matrix(dm)
                    qubit_states[q] = sim.partial_trace(trace_out)
        
        rho = np.eye(1, dtype=complex)
        for q in range(self.total_qubits):
            if q in qubit_states:
                rho = np.kron(rho, qubit_states[q])
            else:
                identity_dm = np.zeros((2, 2), dtype=complex)
                identity_dm[0, 0] = 1.0
                rho = np.kron(rho, identity_dm)
        
        return rho

    def _normalize(self, rho: np.ndarray) -> np.ndarray:
        trace = np.trace(rho)
        if abs(trace) > 1e-12:
            rho = rho / trace
        return rho

    def _make_positive_semidefinite(self, rho: np.ndarray) -> np.ndarray:
        eigenvalues, eigenvectors = np.linalg.eigh(rho)
        eigenvalues = np.maximum(eigenvalues, 0)
        result = eigenvectors @ np.diag(eigenvalues) @ eigenvectors.conj().T
        return self._normalize(result)


class ResultMerger:
    def __init__(self, total_qubits: int):
        self.total_qubits = total_qubits
        self.total_dim = 2 ** total_qubits
        self.subcircuit_results: List[Dict] = []
        self.partitions: List[List[int]] = []
        self.merged_density_matrix: Optional[np.ndarray] = None
        self.amplitude_vector: Optional[np.ndarray] = None
        self.use_mle: bool = True

    def add_results(self, results: List[Dict]) -> None:
        for result in results:
            if result and result.get('density_matrix') is not None:
                self.subcircuit_results.append(result)

    def set_partitions(self, partitions: List[List[int]]) -> None:
        self.partitions = partitions

    def merge(self, use_mle: bool = True) -> np.ndarray:
        self.use_mle = use_mle
        
        if len(self.subcircuit_results) == 1:
            self.merged_density_matrix = self.subcircuit_results[0]['density_matrix']
            return self.merged_density_matrix

        if use_mle and self.partitions:
            mle = MaximumLikelihoodEstimator(self.total_qubits)
            self.merged_density_matrix = mle.estimate(self.subcircuit_results, self.partitions)
        else:
            self.merged_density_matrix = self._simple_merge()
        
        return self.merged_density_matrix

    def _simple_merge(self) -> np.ndarray:
        qubit_to_result: Dict[int, Dict] = {}
        for result in self.subcircuit_results:
            for q in result['qubits']:
                qubit_to_result[q] = result

        merged = np.eye(1, dtype=complex)
        identity_dm = np.zeros((2, 2), dtype=complex)
        identity_dm[0, 0] = 1.0

        for qubit in range(self.total_qubits):
            if qubit in qubit_to_result:
                result = qubit_to_result[qubit]
                local_idx = result['qubits'].index(qubit)
                dm = result['density_matrix']
                
                subcircuit_qubits = len(result['qubits'])
                if subcircuit_qubits == 1:
                    single_qubit_dm = dm
                else:
                    trace_out = [i for i in range(subcircuit_qubits) if i != local_idx]
                    sim = DensityMatrixSimulator(subcircuit_qubits)
                    sim.set_density_matrix(dm)
                    single_qubit_dm = sim.partial_trace(trace_out)
                
                merged = np.kron(merged, single_qubit_dm)
            else:
                merged = np.kron(merged, identity_dm)

        return merged / np.trace(merged)

    def compute_fidelity(self, reference_dm: Optional[np.ndarray] = None) -> float:
        if self.merged_density_matrix is None:
            raise ValueError("No merged density matrix available")

        if reference_dm is None:
            return self._compute_internal_consistency()
        
        sim = DensityMatrixSimulator(self.total_qubits)
        sim.set_density_matrix(self.merged_density_matrix)
        return sim.fidelity_with(reference_dm)

    def _compute_internal_consistency(self) -> float:
        if len(self.subcircuit_results) < 2:
            return 1.0

        consistencies = []
        for i in range(len(self.subcircuit_results)):
            for j in range(i + 1, len(self.subcircuit_results)):
                r1 = self.subcircuit_results[i]
                r2 = self.subcircuit_results[j]
                
                overlap = set(r1['qubits']) & set(r2['qubits'])
                if overlap:
                    dm1 = r1['density_matrix']
                    dm2 = r2['density_matrix']
                    
                    min_dim = min(dm1.shape[0], dm2.shape[0])
                    if dm1.shape[0] != dm2.shape[0]:
                        dm1_small = dm1[:min_dim, :min_dim]
                        dm2_small = dm2[:min_dim, :min_dim]
                    else:
                        dm1_small = dm1
                        dm2_small = dm2
                    
                    sim = DensityMatrixSimulator(int(np.log2(min_dim)))
                    sim.set_density_matrix(dm1_small)
                    fidelity = sim.fidelity_with(dm2_small)
                    consistencies.append(fidelity)

        if consistencies:
            return np.mean(consistencies)
        return 1.0

    def get_amplitude_vector(self) -> np.ndarray:
        if self.merged_density_matrix is None:
            self.merge()

        eigenvalues, eigenvectors = np.linalg.eigh(self.merged_density_matrix)
        max_idx = np.argmax(eigenvalues)
        self.amplitude_vector = eigenvectors[:, max_idx]
        
        norm = np.linalg.norm(self.amplitude_vector)
        if norm > 0:
            self.amplitude_vector /= norm
        
        return self.amplitude_vector

    def get_probabilities(self) -> np.ndarray:
        if self.merged_density_matrix is None:
            self.merge()
        
        return np.real(np.diag(self.merged_density_matrix))

    def get_merged_density_matrix(self) -> Optional[np.ndarray]:
        return self.merged_density_matrix.copy() if self.merged_density_matrix is not None else None

    def print_summary(self) -> None:
        print("=" * 60)
        print("Distributed Quantum Simulation Summary")
        print("=" * 60)
        
        print(f"\nTotal qubits: {self.total_qubits}")
        print(f"Number of subcircuits: {len(self.subcircuit_results)}")
        print(f"MLE correction: {'Enabled' if self.use_mle else 'Disabled'}")
        
        for i, result in enumerate(self.subcircuit_results):
            print(f"\n  Subcircuit {i}:")
            print(f"    Qubits: {result['qubits']}")
            print(f"    External qubits: {result.get('external_qubits', [])}")
            print(f"    Density matrix shape: {result['density_matrix'].shape}")

        if self.merged_density_matrix is not None:
            print(f"\nMerged density matrix shape: {self.merged_density_matrix.shape}")
            
            fidelity = self.compute_fidelity()
            print(f"\nInternal consistency: {fidelity:.6f}")
            
            purity = np.real(np.trace(self.merged_density_matrix @ self.merged_density_matrix))
            print(f"Purity: {purity:.6f}")

            probs = self.get_probabilities()
            print(f"\nTop 5 highest probability states:")
            top_indices = np.argsort(probs)[-5:][::-1]
            for idx in top_indices:
                if probs[idx] > 1e-10:
                    print(f"  |{idx:0{self.total_qubits}b}>: {probs[idx]:.6f}")

        print("\n" + "=" * 60)

    def save_results(self, filename: str) -> None:
        if self.merged_density_matrix is None:
            self.merge()

        np.savez(filename,
                 density_matrix=self.merged_density_matrix,
                 amplitude_vector=self.get_amplitude_vector(),
                 probabilities=self.get_probabilities(),
                 fidelity=self.compute_fidelity(),
                 total_qubits=self.total_qubits,
                 use_mle=self.use_mle)
        print(f"Results saved to {filename}.npz")
