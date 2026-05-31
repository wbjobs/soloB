import networkx as nx
from typing import List, Dict, Tuple, Set, Optional
from .qasm_parser import QuantumCircuit, QuantumGate, QASMParser
from .density_matrix import DensityMatrixSimulator
import copy
import numpy as np


class SubCircuit:
    def __init__(self, subcircuit_id: int, qubits: List[int]):
        self.subcircuit_id = subcircuit_id
        self.qubits = qubits
        self.gates: List[QuantumGate] = []
        self.external_qubits: Set[int] = set()
        self.local_qubit_map: Dict[int, int] = {}
        self.cut_edges: List[Tuple[int, int]] = []
        self.entanglement_entropy: float = 0.0
        
        for local_idx, global_idx in enumerate(qubits):
            self.local_qubit_map[global_idx] = local_idx

    def add_gate(self, gate: QuantumGate) -> None:
        self.gates.append(gate)

    def to_local_qubits(self, global_qubits: List[int]) -> List[int]:
        return [self.local_qubit_map[q] for q in global_qubits if q in self.local_qubit_map]

    def __repr__(self) -> str:
        return f"SubCircuit(id={self.subcircuit_id}, qubits={self.qubits}, gates={len(self.gates)}, entropy={self.entanglement_entropy:.4f})"


class EntanglementAwareCutter:
    def __init__(self, num_partitions: int = 2):
        self.num_partitions = num_partitions
        self.subcircuits: List[SubCircuit] = []
        self.interaction_graph: Optional[nx.Graph] = None
        self.edge_entropies: Dict[Tuple[int, int], float] = {}
        self.best_partition: List[List[int]] = []

    def cut(self, circuit: QuantumCircuit, num_partitions: int = None, 
            use_entanglement_aware: bool = True) -> List[SubCircuit]:
        if num_partitions:
            self.num_partitions = num_partitions
        
        if self.num_partitions == 1:
            subcircuit = SubCircuit(0, list(range(circuit.num_qubits)))
            for gate in circuit.gates:
                subcircuit.add_gate(copy.deepcopy(gate))
            self.subcircuits = [subcircuit]
            return self.subcircuits

        self.interaction_graph = self._build_interaction_graph(circuit)
        
        if use_entanglement_aware:
            self._compute_edge_entanglement_entropies(circuit)
            partitions = self._entanglement_aware_partition(circuit.num_qubits)
        else:
            partitions = self._simple_partition(circuit.num_qubits, self.num_partitions)
        
        self.best_partition = partitions
        self.subcircuits = self._create_subcircuits(circuit, partitions)
        
        return self.subcircuits

    def _build_interaction_graph(self, circuit: QuantumCircuit) -> nx.Graph:
        G = nx.Graph()
        
        for i in range(circuit.num_qubits):
            G.add_node(i)
        
        gate_count = {}
        for gate in circuit.gates:
            if len(gate.qubits) >= 2:
                for i in range(len(gate.qubits)):
                    for j in range(i + 1, len(gate.qubits)):
                        q1, q2 = sorted([gate.qubits[i], gate.qubits[j]])
                        edge = (q1, q2)
                        gate_count[edge] = gate_count.get(edge, 0) + 1
        
        for (q1, q2), count in gate_count.items():
            G.add_edge(q1, q2, weight=count)
        
        return G

    def _compute_edge_entanglement_entropies(self, circuit: QuantumCircuit) -> None:
        sim = DensityMatrixSimulator(circuit.num_qubits)
        
        for gate in circuit.gates:
            if len(gate.qubits) == 1:
                sim.apply_gate(gate)
        
        for edge in self.interaction_graph.edges():
            q1, q2 = edge
            other_qubits = [q for q in range(circuit.num_qubits) if q not in [q1, q2]]
            
            if other_qubits:
                reduced_dm = sim.partial_trace(other_qubits)
                eigenvalues = np.linalg.eigvalsh(reduced_dm)
                eigenvalues = eigenvalues[eigenvalues > 1e-12]
                entropy = -np.real(np.sum(eigenvalues * np.log2(eigenvalues + 1e-12)))
            else:
                entropy = 0.0
            
            self.edge_entropies[edge] = entropy

    def _entanglement_aware_partition(self, num_qubits: int) -> List[List[int]]:
        if self.num_partitions >= num_qubits:
            return [[i] for i in range(num_qubits)]
        
        if not self.edge_entropies:
            return self._simple_partition(num_qubits, self.num_partitions)
        
        G = self.interaction_graph.copy()
        
        for (u, v), entropy in self.edge_entropies.items():
            if G.has_edge(u, v):
                G[u][v]['entropy'] = entropy
                G[u][v]['cut_cost'] = 1.0 / (entropy + 0.01)
        
        partitions = self._k_way_graph_cut(G, self.num_partitions)
        
        return partitions

    def _k_way_graph_cut(self, G: nx.Graph, k: int) -> List[List[int]]:
        nodes = list(G.nodes())
        if len(nodes) <= k:
            return [[node] for node in nodes]
        
        partitions = [set([nodes[i]]) for i in range(k)]
        remaining_nodes = set(nodes[k:])
        
        for node in remaining_nodes:
            best_partition = 0
            min_cut_cost = float('inf')
            
            for i, part in enumerate(partitions):
                cut_cost = 0
                for neighbor in G.neighbors(node):
                    if neighbor in part:
                        edge_data = G.get_edge_data(node, neighbor)
                        cut_cost += edge_data.get('cut_cost', edge_data.get('weight', 1.0))
                
                if cut_cost < min_cut_cost:
                    min_cut_cost = cut_cost
                    best_partition = i
            
            partitions[best_partition].add(node)
        
        final_partitions = [sorted(list(part)) for part in partitions if part]
        
        return self._balance_partitions(final_partitions, k)

    def _balance_partitions(self, partitions: List[List[int]], k: int) -> List[List[int]]:
        while len(partitions) < k:
            largest_idx = max(range(len(partitions)), key=lambda i: len(partitions[i]))
            if len(partitions[largest_idx]) > 1:
                mid = len(partitions[largest_idx]) // 2
                partitions.append(partitions[largest_idx][mid:])
                partitions[largest_idx] = partitions[largest_idx][:mid]
            else:
                break
        
        return partitions

    def _simple_partition(self, num_nodes: int, k: int) -> List[List[int]]:
        nodes_per_partition = (num_nodes + k - 1) // k
        partitions = []
        for i in range(k):
            start = i * nodes_per_partition
            end = min(start + nodes_per_partition, num_nodes)
            if start < end:
                partitions.append(list(range(start, end)))
        return partitions

    def _create_subcircuits(self, circuit: QuantumCircuit, partitions: List[List[int]]) -> List[SubCircuit]:
        subcircuits = []
        qubit_to_subcircuit: Dict[int, int] = {}
        
        for subcircuit_id, qubits in enumerate(partitions):
            subcircuit = SubCircuit(subcircuit_id, qubits)
            subcircuits.append(subcircuit)
            for q in qubits:
                qubit_to_subcircuit[q] = subcircuit_id
        
        for gate in circuit.gates:
            involved_subcircuits = set()
            for q in gate.qubits:
                if q in qubit_to_subcircuit:
                    involved_subcircuits.add(qubit_to_subcircuit[q])
            
            if len(involved_subcircuits) == 1:
                subcircuit_id = involved_subcircuits.pop()
                subcircuit = subcircuits[subcircuit_id]
                mapped_gate = QuantumGate(
                    gate.name,
                    [subcircuit.local_qubit_map[q] for q in gate.qubits],
                    gate.params
                )
                subcircuit.add_gate(mapped_gate)
            else:
                for q in gate.qubits:
                    if q in qubit_to_subcircuit:
                        sc_id = qubit_to_subcircuit[q]
                        subcircuit = subcircuits[sc_id]
                        for q2 in gate.qubits:
                            if q2 not in subcircuit.local_qubit_map:
                                subcircuit.external_qubits.add(q2)
        
        for subcircuit in subcircuits:
            if subcircuit.external_qubits:
                subcircuit.cut_edges = [
                    (q1, q2) for q1 in subcircuit.qubits 
                    for q2 in subcircuit.external_qubits 
                    if (q1, q2) in self.edge_entropies or (q2, q1) in self.edge_entropies
                ]
        
        return subcircuits

    def get_cut_edges(self) -> List[Tuple[int, int]]:
        cut_edges = set()
        for sc in self.subcircuits:
            for edge in sc.cut_edges:
                cut_edges.add(tuple(sorted(edge)))
        return list(cut_edges)

    def get_total_cut_entropy(self) -> float:
        total = 0.0
        for edge in self.get_cut_edges():
            total += self.edge_entropies.get(edge, self.edge_entropies.get((edge[1], edge[0]), 0))
        return total



class MultiLevelCircuitCutter:
    def __init__(self, max_levels: int = 3):
        self.max_levels = max_levels
        self.levels = []
        self.final_subcircuits = []

    def multi_level_cut(self, circuit: QuantumCircuit, 
                          initial_partitions: List[List[int]],
                          memory_manager = None) -> List[SubCircuit]:
        from .memory_manager import MemoryManager
        
        if memory_manager is None:
            memory_manager = MemoryManager()

        current_partitions = initial_partitions
        all_subcircuits = []

        for level in range(self.max_levels):
            level_results = []
            needs_further_cut = []

            for idx, qubits in enumerate(current_partitions):
                subcircuit = self._extract_subcircuit(circuit, qubits, idx)
                
                required_memory = memory_manager.estimate_density_matrix_memory(len(qubits))
                available_memory = memory_manager.get_available_memory_mb()
                
                if required_memory * memory_manager.safety_factor > available_memory and level < self.max_levels - 1:
                    needs_further_cut.append((idx, qubits, subcircuit))
                    level_results.append(('to_cut', qubits))
                else:
                    all_subcircuits.append(subcircuit)
                    level_results.append(('simulate', qubits))

            self.levels.append({
                'level': level,
                'partitions': level_results,
                'subcircuit_count': len([r for r in level_results if r[0] == 'simulate'])
            })

            if not needs_further_cut:
                break

            current_partitions = []
            for _, qubits, sc in needs_further_cut:
                sub_partitions = self._recursive_cut_subcircuit(sc, qubits, circuit, memory_manager)
                current_partitions.extend(sub_partitions)

        for part_qubits in current_partitions:
            subcircuit = self._extract_subcircuit(circuit, part_qubits, len(all_subcircuits))
            all_subcircuits.append(subcircuit)

        self.final_subcircuits = all_subcircuits
        return all_subcircuits

    def _extract_subcircuit(self, circuit: QuantumCircuit, qubits: List[int], subcircuit_id: int) -> SubCircuit:
        subcircuit = SubCircuit(subcircuit_id, qubits)
        
        qubit_set = set(qubits)
        for gate in circuit.gates:
            if all(q in qubit_set for q in gate.qubits):
                mapped_qubits = [qubits.index(q) for q in gate.qubits]
                new_gate = type('Gate', (), {
                    'name': gate.name,
                    'qubits': mapped_qubits,
                    'params': getattr(gate, 'params', [])
                })()
                subcircuit.add_gate(new_gate)

        return subcircuit

    def _recursive_cut_subcircuit(self, subcircuit: SubCircuit, qubits: List[int], 
                                    full_circuit: QuantumCircuit, 
                                    memory_manager) -> List[List[int]]:
        n = len(qubits)
        if n <= 4:
            return [qubits]

        target_size = min(n // 2, memory_manager.max_qubits_per_node)
        
        gate_interactions = self._compute_gate_interactions(subcircuit, qubits)
        
        if gate_interactions:
            best_split = None
            best_cut_value = float('inf')

            edges = sorted(gate_interactions.items(), key=lambda x: x[1])
            
            for (q1, q2), entropy in edges[:max(1, len(edges) // 4)]:
                part1, part2 = self._split_graph(qubits, edges, (q1, q2))
                
                if len(part1) >= target_size // 2 and len(part2) >= target_size // 2:
                    cut_value = entropy * abs(len(part1) - len(part2))
                    
                    if cut_value < best_cut_value:
                        best_cut_value = cut_value
                        best_split = (part1, part2)

            if best_split:
                return [best_split[0], best_split[1]]

        mid = n // 2
        return [qubits[:mid], qubits[mid:]]

    def _compute_gate_interactions(self, subcircuit: SubCircuit, qubits: List[int]) -> Dict[Tuple[int, int], float]:
        interactions = {}
        qubit_to_idx = {q: i for i, q in enumerate(qubits)}

        for gate in subcircuit.gates:
            if len(gate.qubits) >= 2:
                for i in range(len(gate.qubits)):
                    for j in range(i + 1, len(gate.qubits)):
                        q1 = gate.qubits[i]
                        q2 = gate.qubits[j]
                        if q1 < len(qubits) and q2 < len(qubits):
                            q1_global = qubits[q1]
                            q2_global = qubits[q2]
                            key = tuple(sorted([q1_global, q2_global]))
                            interactions[key] = interactions.get(key, 0) + 1.0

        return {k: 1.0 / (1.0 + v) for k, v in interactions.items()}

    def _split_graph(self, qubits: List[int], edges: List, cut_edge: Tuple[int, int]) -> Tuple[List[int], List[int]]:
        q1, q2 = cut_edge
        visited = set()
        stack = [q1]

        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)

            for (eq1, eq2), entropy in edges:
                if eq1 == current and eq2 not in visited and tuple(sorted([eq1, eq2])) != tuple(sorted(cut_edge)):
                    stack.append(eq2)
                if eq2 == current and eq1 not in visited and tuple(sorted([eq1, eq2])) != tuple(sorted(cut_edge)):
                    stack.append(eq1)

        part1 = [q for q in qubits if q in visited]
        part2 = [q for q in qubits if q not in visited]

        return part1, part2

    def get_cutting_summary(self) -> dict:
        return {
            'num_levels': len(self.levels),
            'levels': self.levels,
            'final_subcircuit_count': len(self.final_subcircuits),
            'subcircuit_sizes': [len(sc.qubits) for sc in self.final_subcircuits]
        }


CircuitCutter = EntanglementAwareCutter
