import numpy as np
from typing import List, Dict, Optional
from .qasm_parser import QuantumCircuit, QASMParser
from .circuit_cutter import MultiLevelCircuitCutter
from .memory_manager import MemoryManager, AdaptivePartitioner
from .density_matrix import DensityMatrixSimulator
from .result_merger import ResultMerger


class AdaptiveQuantumSimulator:
    def __init__(self, max_qubits_per_node: int = 15, max_levels: int = 3):
        self.memory_manager = MemoryManager(max_qubits_per_node=max_qubits_per_node)
        self.multi_level_cutter = MultiLevelCircuitCutter(max_levels=max_levels)
        self.adaptive_partitioner = AdaptivePartitioner(self.memory_manager)
        self.total_qubits: int = 0
        self.subcircuits: List = []
        self.results: List[Dict] = []
        self.circuit: Optional[QuantumCircuit] = None

    def get_memory_capability(self) -> Dict:
        stats = self.memory_manager.get_memory_stats()
        max_qubits = self.memory_manager.get_max_simulateable_qubits()
        
        return {
            'memory_stats': stats,
            'max_single_node_qubits': max_qubits,
            'can_simulate_30': self.memory_manager.can_simulate_n_qubits(30),
            'can_simulate_40': self.memory_manager.can_simulate_n_qubits(40),
            'can_simulate_45': self.memory_manager.can_simulate_n_qubits(45)
        }

    def estimate_simulation(self, num_qubits: int, num_gates: int = 100) -> Dict:
        estimate = self.memory_manager.estimate_memory_requirement(num_qubits, num_gates)
        partitions_needed = self.memory_manager.calculate_optimal_partitions(num_qubits)
        
        return {
            'memory_estimate': {
                'density_matrix_mb': estimate.density_matrix_size_mb,
                'overhead_mb': estimate.gate_operation_overhead_mb,
                'total_required_mb': estimate.total_required_mb,
                'available_mb': estimate.available_memory_mb,
                'is_feasible': estimate.is_feasible
            },
            'recommended_partitions': partitions_needed,
            'nodes_required': max(1, partitions_needed // 2),
            'estimated_time_hours': (num_gates * 2 ** min(15, num_qubits)) / 1e9
        }

    def prepare_circuit(self, qasm_str: str, force_partitions: Optional[int] = None) -> List:
        parser = QASMParser()
        self.circuit = parser.parse(qasm_str)
        self.total_qubits = self.circuit.num_qubits

        print(f"[AdaptiveSimulator] Parsed circuit with {self.total_qubits} qubits, {len(self.circuit.gates)} gates")

        memory_stats = self.get_memory_capability()
        print(f"[AdaptiveSimulator] System memory: {memory_stats['memory_stats']['total_gb']:.2f} GB")
        print(f"[AdaptiveSimulator] Max single-node qubits: {memory_stats['max_single_node_qubits']}")

        if self.total_qubits <= memory_stats['max_single_node_qubits']:
            print(f"[AdaptiveSimulator] Circuit fits in single node, no partitioning needed")
            self.subcircuits = self._create_single_subcircuit()
            return self.subcircuits

        if force_partitions:
            initial_partitions = self.adaptive_partitioner.suggest_qubit_repartition(
                list(range(self.total_qubits)),
                (self.total_qubits + force_partitions - 1) // force_partitions
            )
            print(f"[AdaptiveSimulator] Using {len(initial_partitions)} forced initial partitions")
        else:
            initial_partitions = self.adaptive_partitioner.initial_partition(
                self.total_qubits,
                len(self.circuit.gates)
            )
            print(f"[AdaptiveSimulator] Using {len(initial_partitions)} initial partitions")

        for i, part in enumerate(initial_partitions):
            mem_needed = self.memory_manager.estimate_density_matrix_memory(len(part))
            print(f"  Partition {i}: {len(part)} qubits, estimated {mem_needed:.2f} MB")

        self.subcircuits = self.multi_level_cutter.multi_level_cut(
            self.circuit,
            initial_partitions,
            self.memory_manager
        )

        cutting_summary = self.multi_level_cutter.get_cutting_summary()
        print(f"[AdaptiveSimulator] Cutting complete: {cutting_summary['final_subcircuit_count']} subcircuits")
        print(f"  Subcircuit sizes: {cutting_summary['subcircuit_sizes']}")
        print(f"  Levels used: {cutting_summary['num_levels']}")

        return self.subcircuits

    def _create_single_subcircuit(self) -> List:
        from .circuit_cutter import SubCircuit
        
        subcircuit = SubCircuit(0, list(range(self.total_qubits)))
        
        for gate in self.circuit.gates:
            subcircuit.add_gate(gate)
        
        return [subcircuit]

    def simulate_all(self, verbose: bool = False) -> List[Dict]:
        if not self.subcircuits:
            raise ValueError("No subcircuits prepared. Call prepare_circuit() first.")

        self.results = []
        
        for i, sc in enumerate(self.subcircuits):
            if verbose:
                print(f"Simulating subcircuit {i+1}/{len(self.subcircuits)}: {len(sc.qubits)} qubits")
            
            try:
                sim = DensityMatrixSimulator(len(sc.qubits))
                
                for gate in sc.gates:
                    sim.apply_gate(gate)
                
                result = {
                    'subcircuit_id': sc.subcircuit_id,
                    'qubits': sc.qubits,
                    'density_matrix': sim.get_density_matrix(),
                    'purity': sim.purity(),
                    'external_qubits': list(sc.external_qubits) if hasattr(sc, 'external_qubits') else []
                }
                self.results.append(result)
                
            except MemoryError:
                print(f"  MemoryError on subcircuit {i}, attempting further cut...")
                sub_results = self._handle_memory_error(sc)
                self.results.extend(sub_results)

        return self.results

    def _handle_memory_error(self, subcircuit) -> List[Dict]:
        qubits = subcircuit.qubits
        n = len(qubits)
        
        if n <= 4:
            raise MemoryError(f"Cannot reduce below 4 qubits. System needs more memory.")

        mid = n // 2
        part1_qubits = qubits[:mid]
        part2_qubits = qubits[mid:]

        sub_results = []
        
        for part_qubits in [part1_qubits, part2_qubits]:
            sc = self._extract_subcircuit_from_qubits(part_qubits)
            if sc:
                try:
                    sim = DensityMatrixSimulator(len(sc.qubits))
                    for gate in sc.gates:
                        sim.apply_gate(gate)
                    
                    sub_results.append({
                        'subcircuit_id': len(sub_results),
                        'qubits': sc.qubits,
                        'density_matrix': sim.get_density_matrix(),
                        'purity': sim.purity(),
                        'external_qubits': []
                    })
                except MemoryError:
                    recursive_results = self._handle_memory_error(sc)
                    sub_results.extend(recursive_results)

        return sub_results

    def _extract_subcircuit_from_qubits(self, qubits: List[int]):
        from .circuit_cutter import SubCircuit
        
        subcircuit = SubCircuit(0, qubits)
        qubit_set = set(qubits)
        
        for gate in self.circuit.gates:
            if all(q in qubit_set for q in gate.qubits):
                mapped_qubits = [qubits.index(q) for q in gate.qubits]
                new_gate = type('Gate', (), {
                    'name': gate.name,
                    'qubits': mapped_qubits,
                    'params': getattr(gate, 'params', [])
                })()
                subcircuit.add_gate(new_gate)
        
        return subcircuit

    def merge_results(self, use_mle: bool = True) -> np.ndarray:
        if not self.results:
            raise ValueError("No simulation results available.")

        print(f"[AdaptiveSimulator] Merging {len(self.results)} subcircuit results...")

        merger = ResultMerger(self.total_qubits)
        merger.add_results(self.results)
        
        partitions = [r['qubits'] for r in self.results]
        merger.set_partitions(partitions)
        
        merged_dm = merger.merge(use_mle=use_mle)

        print(f"[AdaptiveSimulator] Merge complete. Final density matrix shape: {merged_dm.shape}")

        return merged_dm

    def get_amplitude_vector(self, merged_dm: np.ndarray) -> np.ndarray:
        eigenvalues, eigenvectors = np.linalg.eigh(merged_dm)
        max_idx = np.argmax(eigenvalues)
        amplitudes = eigenvectors[:, max_idx]
        
        norm = np.linalg.norm(amplitudes)
        if norm > 0:
            amplitudes /= norm
        
        return amplitudes

    def run_full_simulation(self, qasm_str: str, verbose: bool = False, 
                           force_partitions: Optional[int] = None,
                           use_mle: bool = True) -> Dict:
        print("=" * 70)
        print("Adaptive Distributed Quantum Circuit Simulator")
        print("=" * 70)

        capability = self.get_memory_capability()
        if verbose:
            print(f"\nSystem Capability:")
            print(f"  Total Memory: {capability['memory_stats']['total_gb']:.2f} GB")
            print(f"  Available Memory: {capability['memory_stats']['available_gb']:.2f} GB")
            print(f"  Max Single-Node Qubits: {capability['max_single_node_qubits']}")
            print(f"  Can simulate 30 qubits: {capability['can_simulate_30']}")
            print(f"  Can simulate 40 qubits: {capability['can_simulate_40']}")
            print(f"  Can simulate 45 qubits: {capability['can_simulate_45']}")

        self.prepare_circuit(qasm_str, force_partitions)
        
        print(f"\nTotal subcircuits to simulate: {len(self.subcircuits)}")
        
        self.simulate_all(verbose=verbose)
        
        merged_dm = self.merge_results(use_mle=use_mle)
        
        amplitudes = self.get_amplitude_vector(merged_dm)
        
        purity = np.real(np.trace(merged_dm @ merged_dm))
        
        result = {
            'total_qubits': self.total_qubits,
            'num_subcircuits': len(self.subcircuits),
            'density_matrix': merged_dm,
            'amplitudes': amplitudes,
            'purity': purity,
            'subcircuit_sizes': [len(sc.qubits) for sc in self.subcircuits],
            'success': True
        }

        print(f"\n" + "=" * 70)
        print(f"Simulation Complete!")
        print(f"  Total qubits: {result['total_qubits']}")
        print(f"  Number of subcircuits: {result['num_subcircuits']}")
        print(f"  Final state purity: {result['purity']:.6f}")
        print(f"  Amplitude vector size: {len(result['amplitudes'])}")
        print("=" * 70)

        return result

    def save_results(self, result: Dict, filename: str = 'simulation_results'):
        np.savez_compressed(
            filename,
            amplitudes=result['amplitudes'],
            density_matrix=result['density_matrix'],
            total_qubits=result['total_qubits'],
            num_subcircuits=result['num_subcircuits'],
            purity=result['purity'],
            subcircuit_sizes=result['subcircuit_sizes']
        )
        print(f"Results saved to {filename}.npz")


def create_large_qasm(num_qubits: int, circuit_type: str = 'random') -> str:
    if num_qubits > 45:
        print(f"Warning: {num_qubits} qubits may require significant memory and computation time")

    qasm_lines = [
        f"// {circuit_type.capitalize()} circuit with {num_qubits} qubits",
        "OPENQASM 3.0;",
        f"qreg q[{num_qubits}];",
        ""
    ]

    if circuit_type == 'ghz':
        qasm_lines.append("h q[0];")
        for i in range(num_qubits - 1):
            qasm_lines.append(f"cx q[{i}], q[{i+1}];")
    
    elif circuit_type == 'qft':
        for i in range(min(num_qubits, 10)):
            qasm_lines.append(f"h q[{i}];")
            for j in range(i + 1, min(num_qubits, 10)):
                angle = np.pi / (2 ** (j - i))
                qasm_lines.append(f"rz({angle:.6f}) q[{j}];")
                qasm_lines.append(f"cx q[{i}], q[{j}];")
                qasm_lines.append(f"rz(-{angle:.6f}) q[{j}];")
                qasm_lines.append(f"cx q[{i}], q[{j}];")
    
    else:
        layers = max(3, 20 // (num_qubits // 5))
        for layer in range(layers):
            step = max(1, num_qubits // 8)
            for i in range(0, num_qubits - 1, step):
                qasm_lines.append(f"h q[{i}];")
                if i + 1 < num_qubits:
                    qasm_lines.append(f"cx q[{i}], q[{i+1}];")

    qasm_str = "\n".join(qasm_lines)
    return qasm_str
