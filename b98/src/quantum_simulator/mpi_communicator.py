import numpy as np
from typing import Dict, List, Tuple, Optional, Any
import pickle

try:
    from mpi4py import MPI
    MPI_AVAILABLE = True
except ImportError:
    MPI_AVAILABLE = False
    print("Warning: mpi4py not available. Running in single-node mode.")


class MPICommunicator:
    def __init__(self):
        if MPI_AVAILABLE:
            self.comm = MPI.COMM_WORLD
            self.rank = self.comm.Get_rank()
            self.size = self.comm.Get_size()
        else:
            self.comm = None
            self.rank = 0
            self.size = 1
        
        self.is_master = self.rank == 0

    def barrier(self) -> None:
        if MPI_AVAILABLE and self.size > 1:
            self.comm.Barrier()

    def scatter_subcircuits(self, subcircuits: List) -> Optional:
        if not MPI_AVAILABLE or self.size == 1:
            return subcircuits[0] if subcircuits else None
        
        if self.is_master:
            subcircuit_data = [pickle.dumps(sc) for sc in subcircuits]
            while len(subcircuit_data) < self.size:
                subcircuit_data.append(None)
        else:
            subcircuit_data = None
        
        local_data = self.comm.scatter(subcircuit_data, root=0)
        
        if local_data is not None:
            return pickle.loads(local_data)
        return None

    def gather_results(self, local_result: Optional[Dict]) -> List[Dict]:
        if not MPI_AVAILABLE or self.size == 1:
            return [local_result] if local_result else []
        
        all_results = self.comm.gather(local_result, root=0)
        
        if self.is_master:
            return [pickle.loads(r) if r else None for r in all_results]
        return []

    def broadcast_data(self, data, root: int = 0) -> Any:
        if not MPI_AVAILABLE or self.size == 1:
            return data
        
        if self.is_master:
            data_pickled = pickle.dumps(data)
        else:
            data_pickled = None
        
        data_pickled = self.comm.bcast(data_pickled, root=root)
        
        return pickle.loads(data_pickled)

    def send_result(self, result: Dict, dest: int) -> None:
        if MPI_AVAILABLE and self.size > 1:
            self.comm.send(pickle.dumps(result), dest=dest)

    def recv_result(self, source: int) -> Optional[Dict]:
        if MPI_AVAILABLE and self.size > 1:
            data = self.comm.recv(source=source)
            return pickle.loads(data) if data else None
        return None

    def get_rank(self) -> int:
        return self.rank

    def get_size(self) -> int:
        return self.size

    def finalize(self) -> None:
        if MPI_AVAILABLE:
            MPI.Finalize()


class DistributedSimulator:
    def __init__(self, communicator: MPICommunicator):
        self.comm = communicator
        self.local_subcircuit = None
        self.local_result = None

    def set_subcircuit(self, subcircuit) -> None:
        self.local_subcircuit = subcircuit

    def run_simulation(self, simulator_class) -> Dict:
        if self.local_subcircuit:
            simulator = simulator_class(len(self.local_subcircuit.qubits))
            for gate in self.local_subcircuit.gates:
                simulator.apply_gate(gate)
            
            self.local_result = {
                'rank': self.comm.get_rank(),
                'subcircuit_id': self.local_subcircuit.subcircuit_id,
                'qubits': self.local_subcircuit.qubits,
                'density_matrix': simulator.get_density_matrix(),
                'external_qubits': list(self.local_subcircuit.external_qubits)
            }
        else:
            self.local_result = {
                'rank': self.comm.get_rank(),
                'subcircuit_id': None,
                'qubits': [],
                'density_matrix': None,
                'external_qubits': []
            }
        
        return self.local_result

    def get_local_result(self) -> Optional[Dict]:
        return self.local_result


class DynamicNodeManager:
    def __init__(self, communicator: MPICommunicator):
        self.comm = communicator
        self.rank = communicator.rank
        self.size = communicator.size
        self.is_master = communicator.is_master
        self.node_allocations = {}
        self.task_queue = []

    def allocate_nodes(self, num_subcircuits: int) -> Dict[int, List[int]]:
        if not self.is_master:
            return {}

        subcircuits_per_node = max(1, (num_subcircuits + self.size - 1) // self.size)
        
        allocations = {}
        sc_idx = 0
        for node_rank in range(self.size):
            allocated = []
            for _ in range(subcircuits_per_node):
                if sc_idx < num_subcircuits:
                    allocated.append(sc_idx)
                    sc_idx += 1
            if allocated:
                allocations[node_rank] = allocated

        self.node_allocations = allocations
        return allocations

    def broadcast_allocations(self, allocations: Dict[int, List[int]]) -> Dict[int, List[int]]:
        if MPI_AVAILABLE and self.size > 1:
            all_allocations = self.comm.comm.bcast(allocations, root=0)
        else:
            all_allocations = allocations
        
        return all_allocations

    def get_local_allocations(self, all_allocations: Dict[int, List[int]]) -> List[int]:
        return all_allocations.get(self.rank, [])

    def dynamic_load_balance(self, completed_subcircuits: List[int], 
                               pending_subcircuits: List[int]) -> Dict[int, List[int]]:
        if not self.is_master:
            return {}

        completion_times = {}
        for sc_id in completed_subcircuits:
            completion_times[sc_id] = 1.0

        work_load = {}
        for node_rank, sc_list in self.node_allocations.items():
            completed_count = sum(1 for sc in sc_list if sc in completed_subcircuits)
            work_load[node_rank] = len(sc_list) - completed_count

        new_allocations = {}
        sorted_nodes = sorted(work_load.keys(), key=lambda x: work_load[x])

        pending_queue = sorted(pending_subcircuits, key=lambda x: -len(str(x)))
        
        for node_rank in sorted_nodes:
            current_load = work_load[node_rank]
            can_accept = max(0, 2 - current_load)
            if can_accept > 0 and pending_queue:
                new_allocations[node_rank] = pending_queue[:can_accept]
                pending_queue = pending_queue[can_accept:]

        return new_allocations

    def send_reassignment(self, reassignment: Dict[int, List[int]]):
        if not MPI_AVAILABLE or self.size == 1:
            return

        for target_rank, sc_ids in reassignment.items():
            self.comm.comm.send(('reassign', sc_ids), dest=target_rank)

    def receive_reassignment(self) -> Optional[List[int]]:
        if not MPI_AVAILABLE or self.size == 1:
            return None

        try:
            self.comm.comm.send(('request', self.rank), dest=0)
            msg_type, data = self.comm.comm.recv(source=0)
            if msg_type == 'reassign':
                return data
        except:
            pass
        return None

    def gather_completion_status(self, completed: List[int]) -> Dict[int, List[int]]:
        if not MPI_AVAILABLE or self.size == 1:
            return {0: completed}

        all_completed = self.comm.comm.gather((self.rank, completed), root=0)
        
        if self.is_master:
            return {rank: comp for rank, comp in all_completed}
        return {}


class HierarchicalResultAggregator:
    def __init__(self, total_qubits: int):
        self.total_qubits = total_qubits
        self.level_results = []
        self.intermediate_states = {}

    def add_level_results(self, level: int, results: List[Dict]):
        self.level_results.append({
            'level': level,
            'results': results
        })

    def hierarchical_merge(self) -> np.ndarray:
        if not self.level_results:
            raise ValueError("No results to merge")

        current_results = self.level_results[0]['results']
        
        for level_data in self.level_results[1:]:
            level = level_data['level']
            level_results = level_data['results']
            current_results = self._merge_level(current_results, level_results)

        final_dm = self._final_merge(current_results)
        return final_dm

    def _merge_level(self, parent_results: List[Dict], child_results: List[Dict]) -> List[Dict]:
        merged = []
        parent_map = {tuple(sorted(r['qubits'])): r for r in parent_results}
        
        for child in child_results:
            child_qubits = tuple(sorted(child['qubits']))
            
            for parent_qubits_key, parent in parent_map.items():
                if all(q in parent_qubits_key for q in child_qubits):
                    merged_result = self._merge_pair(parent, child)
                    if merged_result:
                        merged.append(merged_result)
                    break
            else:
                merged.append(child)

        return merged if merged else parent_results

    def _merge_pair(self, result1: Dict, result2: Dict) -> Optional[Dict]:
        qubits1 = set(result1['qubits'])
        qubits2 = set(result2['qubits'])
        
        overlap = qubits1 & qubits2
        if len(overlap) == 0:
            combined_qubits = sorted(qubits1 | qubits2)
            return {
                'qubits': combined_qubits,
                'density_matrix': self._tensor_product_merge(result1, result2),
                'merged': True
            }
        return None

    def _tensor_product_merge(self, result1: Dict, result2: Dict) -> np.ndarray:
        dm1 = result1['density_matrix']
        dm2 = result2['density_matrix']
        return np.kron(dm1, dm2)

    def _final_merge(self, results: List[Dict]) -> np.ndarray:
        if len(results) == 1:
            return results[0]['density_matrix']

        qubit_map = {}
        for result in results:
            for q in result['qubits']:
                qubit_map[q] = result

        result_dm = results[0]['density_matrix']
        result_qubits = set(results[0]['qubits'])

        for result in results[1:]:
            if not result_qubits & set(result['qubits']):
                result_dm = np.kron(result_dm, result['density_matrix'])
                result_qubits.update(result['qubits'])

        return result_dm

    def get_amplitudes_from_hierarchical(self, merged_dm: np.ndarray) -> np.ndarray:
        eigenvalues, eigenvectors = np.linalg.eigh(merged_dm)
        max_idx = np.argmax(eigenvalues)
        amplitudes = eigenvectors[:, max_idx]
        
        norm = np.linalg.norm(amplitudes)
        if norm > 0:
            amplitudes /= norm
        
        return amplitudes

