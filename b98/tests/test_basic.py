#!/usr/bin/env python3
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

import numpy as np
from quantum_simulator.qasm_parser import QASMParser, QuantumGate
from quantum_simulator.circuit_cutter import CircuitCutter
from quantum_simulator.density_matrix import DensityMatrixSimulator
from quantum_simulator.result_merger import ResultMerger


def test_qasm_parser():
    print("Testing QASM Parser...")
    
    qasm_str = '''
OPENQASM 3.0;
qreg q[2];
h q[0];
cx q[0], q[1];
'''
    parser = QASMParser()
    circuit = parser.parse(qasm_str)
    
    assert circuit.num_qubits == 2
    assert len(circuit.gates) == 2
    assert circuit.gates[0].name == 'h'
    assert circuit.gates[1].name == 'cx'
    
    print("  PASSED: QASM parsing works correctly")


def test_density_matrix():
    print("Testing Density Matrix Simulator...")
    
    sim = DensityMatrixSimulator(2)
    
    h_gate = QuantumGate('h', [0])
    sim.apply_gate(h_gate)
    
    cx_gate = QuantumGate('cx', [0, 1])
    sim.apply_gate(cx_gate)
    
    dm = sim.get_density_matrix()
    assert dm.shape == (4, 4)
    
    expected_state = np.array([1, 0, 0, 1], dtype=complex) / np.sqrt(2)
    expected_dm = np.outer(expected_state, expected_state.conj())
    
    fidelity = sim.fidelity_with(expected_dm)
    assert np.isclose(fidelity, 1.0, atol=1e-6)
    
    print(f"  PASSED: Bell state preparation fidelity = {fidelity:.6f}")


def test_amplitude_vector():
    print("Testing Amplitude Vector...")
    
    sim = DensityMatrixSimulator(2)
    sim.apply_gate(QuantumGate('h', [0]))
    sim.apply_gate(QuantumGate('h', [1]))
    
    amp_vector = sim.get_state_vector()
    assert amp_vector is not None
    
    expected = np.ones(4, dtype=complex) / 2
    assert np.allclose(np.abs(amp_vector), np.abs(expected), atol=1e-6)
    
    print("  PASSED: Amplitude vector extraction works")


def test_circuit_cutter():
    print("Testing Circuit Cutter...")
    
    qasm_str = '''
OPENQASM 3.0;
qreg q[4];
h q[0];
h q[1];
cx q[0], q[2];
cx q[1], q[3];
'''
    parser = QASMParser()
    circuit = parser.parse(qasm_str)
    
    cutter = CircuitCutter(num_partitions=2)
    subcircuits = cutter.cut(circuit)
    
    assert len(subcircuits) <= 2
    print(f"  PASSED: Generated {len(subcircuits)} subcircuits")


def test_result_merger():
    print("Testing Result Merger...")
    
    merger = ResultMerger(2)
    
    sim1 = DensityMatrixSimulator(1)
    sim1.apply_gate(QuantumGate('h', [0]))
    
    sim2 = DensityMatrixSimulator(1)
    sim2.apply_gate(QuantumGate('h', [0]))
    
    results = [
        {
            'rank': 0,
            'subcircuit_id': 0,
            'qubits': [0],
            'density_matrix': sim1.get_density_matrix(),
            'external_qubits': []
        },
        {
            'rank': 1,
            'subcircuit_id': 1,
            'qubits': [1],
            'density_matrix': sim2.get_density_matrix(),
            'external_qubits': []
        }
    ]
    
    merger.add_results(results)
    merger.set_partitions([[0], [1]])
    merged = merger.merge(use_mle=True)
    
    assert merged.shape == (4, 4)
    
    amp = merger.get_amplitude_vector()
    assert len(amp) == 4
    
    print("  PASSED: Result merging works")


def test_purity_and_fidelity():
    print("Testing Purity and Fidelity...")
    
    sim = DensityMatrixSimulator(2)
    sim.apply_gate(QuantumGate('h', [0]))
    sim.apply_gate(QuantumGate('cx', [0, 1]))
    
    purity = sim.purity()
    assert np.isclose(purity, 1.0, atol=1e-6)
    print(f"  PASSED: Pure state purity = {purity:.6f}")
    
    fidelity = sim.fidelity_with(sim.get_density_matrix())
    assert np.isclose(fidelity, 1.0, atol=1e-6)
    print(f"  PASSED: Self-fidelity = {fidelity:.6f}")


def main():
    print("=" * 60)
    print("Running Basic Tests for Distributed Quantum Simulator")
    print("=" * 60 + "\n")
    
    try:
        test_qasm_parser()
        test_density_matrix()
        test_amplitude_vector()
        test_circuit_cutter()
        test_result_merger()
        test_purity_and_fidelity()
        
        print("\n" + "=" * 60)
        print("All tests PASSED!")
        print("=" * 60)
    except AssertionError as e:
        print(f"\nTest FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nError during testing: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
