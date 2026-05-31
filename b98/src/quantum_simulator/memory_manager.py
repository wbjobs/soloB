import numpy as np
import sys
import psutil
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass


@dataclass
class MemoryEstimate:
    total_qubits: int
    density_matrix_size_mb: float
    gate_operation_overhead_mb: float
    total_required_mb: float
    available_memory_mb: float
    is_feasible: bool
    recommended_partitions: int


class MemoryManager:
    def __init__(self, safety_factor: float = 1.5, max_qubits_per_node: int = 15):
        self.safety_factor = safety_factor
        self.max_qubits_per_node = max_qubits_per_node
        self.complex_byte_size = 16

    def estimate_density_matrix_memory(self, num_qubits: int) -> float:
        dim = 2 ** num_qubits
        matrix_size = dim * dim * self.complex_byte_size
        return matrix_size / (1024 ** 2)

    def estimate_gate_overhead(self, num_qubits: int, num_gates: int = 100) -> float:
        dim = 2 ** num_qubits
        gate_size_per_qubit = 2 * 2 * self.complex_byte_size
        overhead = gate_size_per_qubit * num_qubits * num_gates
        return overhead / (1024 ** 2)

    def get_available_memory_mb(self) -> float:
        try:
            mem = psutil.virtual_memory()
            return mem.available / (1024 ** 2)
        except:
            return 8 * 1024

    def estimate_memory_requirement(self, num_qubits: int, num_gates: int = 100) -> MemoryEstimate:
        dm_size = self.estimate_density_matrix_memory(num_qubits)
        overhead = self.estimate_gate_overhead(num_qubits, num_gates)
        total_required = (dm_size + overhead) * self.safety_factor
        available = self.get_available_memory_mb()
        is_feasible = total_required < available

        recommended = self.calculate_optimal_partitions(num_qubits, available)

        return MemoryEstimate(
            total_qubits=num_qubits,
            density_matrix_size_mb=dm_size,
            gate_operation_overhead_mb=overhead,
            total_required_mb=total_required,
            available_memory_mb=available,
            is_feasible=is_feasible,
            recommended_partitions=recommended
        )

    def calculate_optimal_partitions(self, num_qubits: int, available_memory_mb: Optional[float] = None) -> int:
        if available_memory_mb is None:
            available_memory_mb = self.get_available_memory_mb()

        qubits_per_partition = self.max_qubits_per_node
        while qubits_per_partition > 2:
            required = self.estimate_density_matrix_memory(qubits_per_partition)
            if required * self.safety_factor < available_memory_mb:
                break
            qubits_per_partition -= 1

        num_partitions = (num_qubits + qubits_per_partition - 1) // qubits_per_partition
        return max(2, num_partitions)

    def check_partition_feasibility(self, partition_qubits: List[int]) -> Tuple[bool, List[int]]:
        available = self.get_available_memory_mb()
        needs_resize = []

        for i, num_qubits in enumerate(partition_qubits):
            required = self.estimate_density_matrix_memory(num_qubits) * self.safety_factor
            if required > available:
                needs_resize.append(i)

        return len(needs_resize) == 0, needs_resize

    def suggest_qubit_repartition(self, qubits: List[int], target_qubits_per_partition: int) -> List[List[int]]:
        partitions = []
        current = []

        for q in sorted(qubits):
            current.append(q)
            if len(current) >= target_qubits_per_partition:
                partitions.append(current)
                current = []

        if current:
            partitions.append(current)

        return partitions

    def get_memory_stats(self) -> Dict[str, float]:
        mem = psutil.virtual_memory()
        return {
            'total_gb': mem.total / (1024 ** 3),
            'available_gb': mem.available / (1024 ** 3),
            'used_gb': mem.used / (1024 ** 3),
            'percent_used': mem.percent
        }

    def can_simulate_n_qubits(self, n: int) -> bool:
        estimate = self.estimate_memory_requirement(n)
        return estimate.is_feasible

    def get_max_simulateable_qubits(self) -> int:
        available = self.get_available_memory_mb()
        qubits = 1
        while True:
            required = self.estimate_density_matrix_memory(qubits) * self.safety_factor
            if required > available:
                return qubits - 1
            qubits += 1
            if qubits > 50:
                return 50


class AdaptivePartitioner:
    def __init__(self, memory_manager: MemoryManager):
        self.memory_manager = memory_manager
        self.partition_history = []

    def initial_partition(self, num_qubits: int, num_gates: int = 0) -> List[List[int]]:
        estimate = self.memory_manager.estimate_memory_requirement(num_qubits, num_gates)
        num_partitions = estimate.recommended_partitions
        qubits_per_partition = (num_qubits + num_partitions - 1) // num_partitions

        partitions = []
        for i in range(0, num_qubits, qubits_per_partition):
            partitions.append(list(range(i, min(i + qubits_per_partition, num_qubits))))

        self.partition_history.append({
            'level': 0,
            'partitions': partitions,
            'memory_estimate': estimate
        })

        return partitions

    def adaptive_repartition(self, partitions: List[List[int]], 
                              gate_interactions: Dict[Tuple[int, int], float]) -> List[List[int]]:
        partition_sizes = [len(p) for p in partitions]
        feasible, needs_resize = self.memory_manager.check_partition_feasibility(partition_sizes)

        if feasible:
            return partitions

        new_partitions = []
        for i, part in enumerate(partitions):
            if i in needs_resize and len(part) > 4:
                sub_partitions = self._split_partition_by_entropy(part, gate_interactions)
                new_partitions.extend(sub_partitions)
            else:
                new_partitions.append(part)

        self.partition_history.append({
            'level': len(self.partition_history),
            'partitions': new_partitions,
            'resized_indices': needs_resize
        })

        return new_partitions

    def _split_partition_by_entropy(self, qubits: List[int], 
                                      gate_interactions: Dict[Tuple[int, int], float]) -> List[List[int]]:
        if len(qubits) <= 4:
            return [qubits]

        edges = []
        for i in range(len(qubits)):
            for j in range(i + 1, len(qubits)):
                q1, q2 = qubits[i], qubits[j]
                entropy = gate_interactions.get((q1, q2), gate_interactions.get((q2, q1), 0.5))
                edges.append((q1, q2, entropy))

        edges.sort(key=lambda x: x[2])

        mid = len(edges) // 2
        cut_candidates = edges[:max(1, mid)]

        best_split = None
        best_balance = float('inf')

        for cut in cut_candidates:
            q1, q2, _ = cut

            visited = set()
            stack = [q1]
            while stack:
                current = stack.pop()
                if current in visited:
                    continue
                visited.add(current)
                for eq1, eq2, _ in edges:
                    if eq1 == current and eq2 not in visited and (eq1, eq2) != cut:
                        stack.append(eq2)
                    if eq2 == current and eq1 not in visited and (eq1, eq2) != cut:
                        stack.append(eq1)

            part1 = [q for q in qubits if q in visited]
            part2 = [q for q in qubits if q not in visited]

            if part1 and part2:
                balance = abs(len(part1) - len(part2))
                if balance < best_balance:
                    best_balance = balance
                    best_split = (part1, part2)

        if best_split:
            result = []
            for part in best_split:
                if len(part) > self.memory_manager.max_qubits_per_node:
                    sub_interactions = {k: v for k, v in gate_interactions.items() 
                                        if k[0] in part and k[1] in part}
                    result.extend(self._split_partition_by_entropy(part, sub_interactions))
                else:
                    result.append(part)
            return result
        else:
            mid = len(qubits) // 2
            return [qubits[:mid], qubits[mid:]]
