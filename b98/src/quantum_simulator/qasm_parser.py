import re
from typing import List, Dict, Tuple, Optional
import numpy as np


class QuantumGate:
    def __init__(self, name: str, qubits: List[int], params: Optional[List[float]] = None):
        self.name = name
        self.qubits = qubits
        self.params = params or []

    def __repr__(self) -> str:
        if self.params:
            return f"{self.name}({', '.join(map(str, self.params))}) q[{self.qubits[0]}]"
        return f"{self.name} q[{self.qubits[0]}]" if len(self.qubits) == 1 else f"{self.name} q[{self.qubits[0]}], q[{self.qubits[1]}]"


class QuantumCircuit:
    def __init__(self, num_qubits: int):
        self.num_qubits = num_qubits
        self.gates: List[QuantumGate] = []
        self.qubit_map: Dict[str, int] = {}

    def add_gate(self, gate: QuantumGate) -> None:
        self.gates.append(gate)

    def __repr__(self) -> str:
        return f"QuantumCircuit({self.num_qubits} qubits, {len(self.gates)} gates)"


class QASMParser:
    def __init__(self):
        self.circuit: Optional[QuantumCircuit] = None
        self.gate_definitions: Dict[str, List] = {}

    def parse(self, qasm_str: str) -> QuantumCircuit:
        lines = self._preprocess(qasm_str)
        num_qubits = self._extract_num_qubits(lines)
        self.circuit = QuantumCircuit(num_qubits)
        
        for line in lines:
            self._parse_line(line)
        
        return self.circuit

    def parse_file(self, file_path: str) -> QuantumCircuit:
        with open(file_path, 'r', encoding='utf-8') as f:
            return self.parse(f.read())

    def _preprocess(self, qasm_str: str) -> List[str]:
        lines = []
        for line in qasm_str.split('\n'):
            line = re.sub(r'//.*$', '', line).strip()
            if line and not line.startswith('//'):
                lines.append(line)
        return lines

    def _extract_num_qubits(self, lines: List[str]) -> int:
        for line in lines:
            if 'qreg' in line:
                match = re.search(r'qreg\s+\w+\[(\d+)\]', line)
                if match:
                    return int(match.group(1))
        
        max_qubit = -1
        qubit_regex = re.compile(r'q\[(\d+)\]')
        
        for line in lines:
            if line.strip().startswith('qreg') or line.strip().startswith('creg'):
                continue
            matches = qubit_regex.findall(line)
            for match in matches:
                qubit_idx = int(match)
                if qubit_idx > max_qubit:
                    max_qubit = qubit_idx
        
        if max_qubit == -1:
            return 1
        
        return max_qubit + 1

    def _parse_line(self, line: str) -> None:
        if line.startswith('OPENQASM') or line.startswith('include') or line.startswith('qreg') or line.startswith('creg'):
            return

        gate_match = re.match(r'(\w+)(?:\(([^)]+)\))?\s+(.+);', line)
        if gate_match:
            gate_name = gate_match.group(1)
            params_str = gate_match.group(2)
            qubits_str = gate_match.group(3)
            
            params = []
            if params_str:
                params = [self._eval_param(p.strip()) for p in params_str.split(',')]
            
            qubits = self._parse_qubits(qubits_str)
            
            if qubits:
                gate = QuantumGate(gate_name, qubits, params)
                self.circuit.add_gate(gate)

    def _parse_qubits(self, qubits_str: str) -> List[int]:
        qubits = []
        qubit_pattern = re.compile(r'q\[(\d+)\]')
        matches = qubit_pattern.findall(qubits_str)
        for match in matches:
            qubits.append(int(match))
        return qubits

    def _eval_param(self, param_str: str) -> float:
        param_str = param_str.replace('pi', str(np.pi))
        param_str = param_str.replace('π', str(np.pi))
        try:
            return float(eval(param_str, {"__builtins__": None}, {"np": np}))
        except:
            return 0.0

    def get_interaction_graph(self) -> List[Tuple[int, int]]:
        if not self.circuit:
            return []
        
        edges = set()
        for gate in self.circuit.gates:
            if len(gate.qubits) >= 2:
                for i in range(len(gate.qubits)):
                    for j in range(i + 1, len(gate.qubits)):
                        edge = tuple(sorted([gate.qubits[i], gate.qubits[j]]))
                        edges.add(edge)
        
        return list(edges)
