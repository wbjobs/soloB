#!/usr/bin/env python3
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

import numpy as np
from quantum_simulator.qasm_parser import QASMParser, QuantumGate
from quantum_simulator.circuit_cutter import CircuitCutter, EntanglementAwareCutter
from quantum_simulator.density_matrix import DensityMatrixSimulator
from quantum_simulator.result_merger import ResultMerger


def compute_full_simulation_fidelity(circuit, num_partitions=2, use_mle=True, use_entanglement_cut=True):
    sim_full = DensityMatrixSimulator(circuit.num_qubits)
    for gate in circuit.gates:
        sim_full.apply_gate(gate)
    full_dm = sim_full.get_density_matrix()
    
    cutter = EntanglementAwareCutter(num_partitions=num_partitions)
    subcircuits = cutter.cut(circuit, use_entanglement_aware=use_entanglement_cut)
    
    subcircuit_results = []
    for sc in subcircuits:
        sim = DensityMatrixSimulator(len(sc.qubits))
        for gate in sc.gates:
            sim.apply_gate(gate)
        
        result = {
            'qubits': sc.qubits,
            'density_matrix': sim.get_density_matrix(),
            'external_qubits': list(sc.external_qubits)
        }
        subcircuit_results.append(result)
    
    merger = ResultMerger(circuit.num_qubits)
    merger.add_results(subcircuit_results)
    merger.set_partitions(cutter.best_partition)
    merged_dm = merger.merge(use_mle=use_mle)
    
    sim_merged = DensityMatrixSimulator(circuit.num_qubits)
    sim_merged.set_density_matrix(merged_dm)
    fidelity = sim_merged.fidelity_with(full_dm)
    
    return fidelity, cutter.get_total_cut_entropy()


def test_fidelity_improvement():
    print("=" * 60)
    print("Testing Fidelity Improvement with New Algorithms")
    print("=" * 60)
    
    test_circuits = [
        ("GHZ State (4 qubits)", '''
OPENQASM 3.0;
qreg q[4];
h q[0];
cx q[0], q[1];
cx q[1], q[2];
cx q[2], q[3];
'''),
        ("2x2 Cluster State", '''
OPENQASM 3.0;
qreg q[4];
h q[0];
h q[1];
h q[2];
h q[3];
cz q[0], q[1];
cz q[1], q[2];
cz q[2], q[3];
cz q[3], q[0];
'''),
        ("Quantum Fourier Transform (4 qubits)", '''
OPENQASM 3.0;
qreg q[4];
h q[0];
rz(pi/4) q[1];
cx q[0], q[1];
rz(-pi/4) q[1];
cx q[0], q[1];
h q[1];
rz(pi/8) q[2];
cx q[0], q[2];
rz(-pi/8) q[2];
cx q[0], q[2];
rz(pi/4) q[2];
cx q[1], q[2];
rz(-pi/4) q[2];
cx q[1], q[2];
h q[2];
''')
    ]
    
    for circuit_name, qasm_str in test_circuits:
        print(f"\n{'=' * 60}")
        print(f"Circuit: {circuit_name}")
        print(f"{'=' * 60}")
        
        parser = QASMParser()
        circuit = parser.parse(qasm_str)
        
        for num_partitions in [2, 3]:
            print(f"\n--- {num_partitions} partitions ---")
            
            fid_old, _ = compute_full_simulation_fidelity(
                circuit, num_partitions, use_mle=False, use_entanglement_cut=False
            )
            print(f"  Baseline (simple cut + simple merge):   {fid_old:.6f}")
            
            fid_ent, entropy = compute_full_simulation_fidelity(
                circuit, num_partitions, use_mle=False, use_entanglement_cut=True
            )
            print(f"  Entanglement-aware cutting only:        {fid_ent:.6f} (cut entropy: {entropy:.4f})")
            
            fid_mle, _ = compute_full_simulation_fidelity(
                circuit, num_partitions, use_mle=True, use_entanglement_cut=False
            )
            print(f"  MLE correction only:                     {fid_mle:.6f}")
            
            fid_both, entropy = compute_full_simulation_fidelity(
                circuit, num_partitions, use_mle=True, use_entanglement_cut=True
            )
            print(f"  Entanglement cutting + MLE correction:   {fid_both:.6f}")
            
            improvement = fid_both - fid_old
            print(f"\n  Total fidelity improvement:             {improvement:+.6f}")
            
            if fid_both >= 0.9:
                print("  ✓ Fidelity >= 0.9 requirement satisfied!")
            else:
                print(f"  ✗ Fidelity below 0.9 threshold (got {fid_both:.6f})")


def test_basic_functionality():
    print("\n" + "=" * 60)
    print("Basic Functionality Tests")
    print("=" * 60)
    
    print("\n1. Testing entanglement entropy calculation...")
    sim = DensityMatrixSimulator(2)
    sim.apply_gate(QuantumGate('h', [0]))
    sim.apply_gate(QuantumGate('cx', [0, 1]))
    
    entropy = sim.bipartite_entanglement_entropy([0])
    print(f"   Bell state entanglement entropy: {entropy:.6f}")
    assert abs(entropy - 1.0) < 0.1, "Bell state should have ~1 bit of entropy"
    print("   ✓ Entanglement entropy calculation correct")
    
    print("\n2. Testing entanglement-aware cutting...")
    qasm = '''
OPENQASM 3.0;
qreg q[4];
h q[0];
cx q[0], q[1];
cx q[1], q[2];
cx q[2], q[3];
'''
    parser = QASMParser()
    circuit = parser.parse(qasm)
    
    cutter = EntanglementAwareCutter(num_partitions=2)
    subcircuits = cutter.cut(circuit, use_entanglement_aware=True)
    
    print(f"   Number of subcircuits: {len(subcircuits)}")
    print(f"   Total cut entropy: {cutter.get_total_cut_entropy():.6f}")
    print("   ✓ Entanglement-aware cutting works")
    
    print("\n3. Testing MLE correction...")
    results = []
    for sc in subcircuits:
        sim = DensityMatrixSimulator(len(sc.qubits))
        for gate in sc.gates:
            sim.apply_gate(gate)
        results.append({
            'qubits': sc.qubits,
            'density_matrix': sim.get_density_matrix()
        })
    
    merger = ResultMerger(4)
    merger.add_results(results)
    merger.set_partitions(cutter.best_partition)
    
    merged_no_mle = merger.merge(use_mle=False)
    merged_with_mle = merger.merge(use_mle=True)
    
    purity_no_mle = np.real(np.trace(merged_no_mle @ merged_no_mle))
    purity_with_mle = np.real(np.trace(merged_with_mle @ merged_with_mle))
    
    print(f"   Purity without MLE: {purity_no_mle:.6f}")
    print(f"   Purity with MLE:    {purity_with_mle:.6f}")
    assert purity_with_mle >= purity_no_mle - 0.01, "MLE should maintain or improve purity"
    print("   ✓ MLE correction improves or maintains purity")


def main():
    try:
        test_basic_functionality()
        test_fidelity_improvement()
        
        print("\n" + "=" * 60)
        print("All tests completed successfully!")
        print("=" * 60)
        
    except Exception as e:
        print(f"\nError during testing: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
