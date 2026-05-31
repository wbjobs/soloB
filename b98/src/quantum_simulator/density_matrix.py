import numpy as np
from typing import Optional, List
from .qasm_parser import QuantumGate


class DensityMatrixSimulator:
    def __init__(self, num_qubits: int):
        self.num_qubits = num_qubits
        self.dim = 2 ** num_qubits
        self.density_matrix = np.zeros((self.dim, self.dim), dtype=complex)
        self.density_matrix[0, 0] = 1.0

    def reset(self) -> None:
        self.density_matrix = np.zeros((self.dim, self.dim), dtype=complex)
        self.density_matrix[0, 0] = 1.0

    def get_density_matrix(self) -> np.ndarray:
        return self.density_matrix.copy()

    def set_density_matrix(self, dm: np.ndarray) -> None:
        self.density_matrix = dm.copy()

    def apply_gate(self, gate: QuantumGate) -> None:
        gate_matrix = self._get_gate_matrix(gate)
        if gate_matrix is not None:
            expanded_gate = self._expand_gate(gate_matrix, gate.qubits)
            self.density_matrix = expanded_gate @ self.density_matrix @ expanded_gate.conj().T

    def _get_gate_matrix(self, gate: QuantumGate) -> Optional[np.ndarray]:
        gate_name = gate.name.lower()
        
        if gate_name == 'h':
            return np.array([[1, 1], [1, -1]], dtype=complex) / np.sqrt(2)
        
        elif gate_name == 'x':
            return np.array([[0, 1], [1, 0]], dtype=complex)
        
        elif gate_name == 'y':
            return np.array([[0, -1j], [1j, 0]], dtype=complex)
        
        elif gate_name == 'z':
            return np.array([[1, 0], [0, -1]], dtype=complex)
        
        elif gate_name == 's':
            return np.array([[1, 0], [0, 1j]], dtype=complex)
        
        elif gate_name == 'sdg':
            return np.array([[1, 0], [0, -1j]], dtype=complex)
        
        elif gate_name == 't':
            return np.array([[1, 0], [0, np.exp(1j * np.pi / 4)]], dtype=complex)
        
        elif gate_name == 'tdg':
            return np.array([[1, 0], [0, np.exp(-1j * np.pi / 4)]], dtype=complex)
        
        elif gate_name == 'rx' and gate.params:
            theta = gate.params[0]
            return np.array([
                [np.cos(theta / 2), -1j * np.sin(theta / 2)],
                [-1j * np.sin(theta / 2), np.cos(theta / 2)]
            ], dtype=complex)
        
        elif gate_name == 'ry' and gate.params:
            theta = gate.params[0]
            return np.array([
                [np.cos(theta / 2), -np.sin(theta / 2)],
                [np.sin(theta / 2), np.cos(theta / 2)]
            ], dtype=complex)
        
        elif gate_name == 'rz' and gate.params:
            theta = gate.params[0]
            return np.array([
                [np.exp(-1j * theta / 2), 0],
                [0, np.exp(1j * theta / 2)]
            ], dtype=complex)
        
        elif gate_name == 'u' and len(gate.params) >= 3:
            theta, phi, lam = gate.params[0], gate.params[1], gate.params[2]
            return np.array([
                [np.cos(theta / 2), -np.exp(1j * lam) * np.sin(theta / 2)],
                [np.exp(1j * phi) * np.sin(theta / 2), np.exp(1j * (phi + lam)) * np.cos(theta / 2)]
            ], dtype=complex)
        
        elif gate_name == 'cx' or gate_name == 'cnot':
            return np.array([
                [1, 0, 0, 0],
                [0, 1, 0, 0],
                [0, 0, 0, 1],
                [0, 0, 1, 0]
            ], dtype=complex)
        
        elif gate_name == 'cz':
            return np.array([
                [1, 0, 0, 0],
                [0, 1, 0, 0],
                [0, 0, 1, 0],
                [0, 0, 0, -1]
            ], dtype=complex)
        
        elif gate_name == 'swap':
            return np.array([
                [1, 0, 0, 0],
                [0, 0, 1, 0],
                [0, 1, 0, 0],
                [0, 0, 0, 1]
            ], dtype=complex)
        
        elif gate_name == 'id' or gate_name == 'i':
            return np.eye(2, dtype=complex)
        
        return None

    def _expand_gate(self, gate_matrix: np.ndarray, qubits: List[int]) -> np.ndarray:
        num_gate_qubits = len(qubits)
        
        if num_gate_qubits == 1:
            target = qubits[0]
            left_size = 2 ** target
            right_size = 2 ** (self.num_qubits - target - 1)
            
            I_left = np.eye(left_size, dtype=complex)
            I_right = np.eye(right_size, dtype=complex)
            
            return np.kron(np.kron(I_left, gate_matrix), I_right)
        
        elif num_gate_qubits == 2:
            q0, q1 = qubits[0], qubits[1]
            
            result = np.zeros((self.dim, self.dim), dtype=complex)
            
            for row in range(self.dim):
                for col in range(self.dim):
                    other_match = True
                    for k in range(self.num_qubits):
                        if k != q0 and k != q1:
                            if ((row >> k) & 1) != ((col >> k) & 1):
                                other_match = False
                                break
                    
                    if other_match:
                        row_q0 = (row >> q0) & 1
                        row_q1 = (row >> q1) & 1
                        col_q0 = (col >> q0) & 1
                        col_q1 = (col >> q1) & 1
                        
                        gate_row = row_q1 * 2 + row_q0
                        gate_col = col_q1 * 2 + col_q0
                        
                        result[row, col] = gate_matrix[gate_row, gate_col]
            
            return result
        
        return np.eye(self.dim, dtype=complex)

    def _swap_qubits_in_matrix(self, matrix: np.ndarray) -> np.ndarray:
        swap = np.array([
            [1, 0, 0, 0],
            [0, 0, 1, 0],
            [0, 1, 0, 0],
            [0, 0, 0, 1]
        ], dtype=complex)
        return swap @ matrix @ swap

    def partial_trace(self, qubits_to_trace_out: List[int]) -> np.ndarray:
        remaining_qubits = [q for q in range(self.num_qubits) if q not in qubits_to_trace_out]
        
        if not remaining_qubits:
            return np.trace(self.density_matrix)
        
        result_dim = 2 ** len(remaining_qubits)
        result = np.zeros((result_dim, result_dim), dtype=complex)
        
        qubits_to_trace_out.sort(reverse=True)
        
        dm = self.density_matrix.copy()
        current_qubits = self.num_qubits
        
        for qubit in qubits_to_trace_out:
            dim = 2 ** current_qubits
            block_size = 2 ** (current_qubits - qubit - 1)
            num_blocks = 2 ** qubit
            
            new_dm = np.zeros((dim // 2, dim // 2), dtype=complex)
            
            for i in range(num_blocks):
                for j in range(num_blocks):
                    for k in range(block_size):
                        for l in range(block_size):
                            idx_i = i * 2 * block_size + k
                            idx_j = j * 2 * block_size + l
                            new_dm[i * block_size + k, j * block_size + l] = (
                                dm[idx_i, idx_j] + 
                                dm[idx_i + block_size, idx_j + block_size]
                            )
            
            dm = new_dm
            current_qubits -= 1
        
        return dm

    def get_state_vector(self) -> Optional[np.ndarray]:
        eigenvalues, eigenvectors = np.linalg.eigh(self.density_matrix)
        max_idx = np.argmax(eigenvalues)
        
        if eigenvalues[max_idx] > 0.99:
            return eigenvectors[:, max_idx]
        return None

    def get_probabilities(self) -> np.ndarray:
        return np.real(np.diag(self.density_matrix))

    def measure(self, qubits: Optional[List[int]] = None) -> int:
        if qubits is None:
            qubits = list(range(self.num_qubits))
        
        probs = self.get_probabilities()
        outcome = np.random.choice(len(probs), p=probs / np.sum(probs))
        
        return outcome

    def expectation_value(self, observable: np.ndarray) -> complex:
        return np.trace(self.density_matrix @ observable)

    def fidelity_with(self, other_dm: np.ndarray) -> float:
        sqrt_rho = self._matrix_sqrt(self.density_matrix)
        product = sqrt_rho @ other_dm @ sqrt_rho
        sqrt_product = self._matrix_sqrt(product)
        return np.real(np.trace(sqrt_product)) ** 2

    def _matrix_sqrt(self, matrix: np.ndarray) -> np.ndarray:
        eigenvalues, eigenvectors = np.linalg.eigh(matrix)
        eigenvalues = np.maximum(eigenvalues, 0)
        sqrt_eigenvalues = np.sqrt(eigenvalues)
        return eigenvectors @ np.diag(sqrt_eigenvalues) @ eigenvectors.conj().T

    def purity(self) -> float:
        return np.real(np.trace(self.density_matrix @ self.density_matrix))

    def von_neumann_entropy(self) -> float:
        eigenvalues = np.linalg.eigvalsh(self.density_matrix)
        eigenvalues = eigenvalues[eigenvalues > 1e-12]
        return -np.real(np.sum(eigenvalues * np.log2(eigenvalues)))

    def bipartite_entanglement_entropy(self, subsystem_qubits: List[int]) -> float:
        reduced_dm = self.partial_trace(subsystem_qubits)
        eigenvalues = np.linalg.eigvalsh(reduced_dm)
        eigenvalues = eigenvalues[eigenvalues > 1e-12]
        return -np.real(np.sum(eigenvalues * np.log2(eigenvalues)))

    def mutual_information(self, qubits_a: List[int], qubits_b: List[int]) -> float:
        s_a = self.bipartite_entanglement_entropy([q for q in range(self.num_qubits) if q not in qubits_a])
        s_b = self.bipartite_entanglement_entropy([q for q in range(self.num_qubits) if q not in qubits_b])
        s_ab = self.bipartite_entanglement_entropy([q for q in range(self.num_qubits) if q not in qubits_a + qubits_b])
        return s_a + s_b - s_ab
