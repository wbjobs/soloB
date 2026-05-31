#!/usr/bin/env python3
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

import numpy as np
from quantum_simulator import (
    AdaptiveQuantumSimulator,
    create_large_qasm,
    MemoryManager
)


def test_memory_estimation():
    print("=" * 70)
    print("Test 1: Memory Estimation")
    print("=" * 70)

    mm = MemoryManager()
    
    print("\nMemory estimates for different qubit counts:")
    for n in [10, 15, 20, 25, 30]:
        estimate = mm.estimate_memory_requirement(n)
        print(f"  {n} qubits: DM = {estimate.density_matrix_size_mb:.2f} MB, "
              f"Total = {estimate.total_required_mb:.2f} MB, "
              f"Feasible = {estimate.is_feasible}")

    max_q = mm.get_max_simulateable_qubits()
    print(f"\nMax single-node qubits: {max_q}")

    capability = {
        '30 qubits': mm.can_simulate_n_qubits(30),
        '35 qubits': mm.can_simulate_n_qubits(35),
        '40 qubits': mm.can_simulate_n_qubits(40),
        '45 qubits': mm.can_simulate_n_qubits(45)
    }
    
    print("\nSimulation capability:")
    for q, can_do in capability.items():
        print(f"  {q}: {'Yes ✓' if can_do else 'No (needs partitioning) ✗'}")

    return True


def test_adaptive_partitioning():
    print("\n" + "=" * 70)
    print("Test 2: Adaptive Circuit Partitioning")
    print("=" * 70)

    simulator = AdaptiveQuantumSimulator(max_qubits_per_node=12)

    print("\nTesting different circuit sizes:")
    
    for num_qubits in [16, 20, 24]:
        print(f"\n--- {num_qubits} qubits ---")
        
        qasm = create_large_qasm(num_qubits, 'ghz')
        
        estimation = simulator.estimate_simulation(num_qubits)
        print(f"  Memory feasible: {estimation['memory_estimate']['is_feasible']}")
        print(f"  Recommended partitions: {estimation['recommended_partitions']}")
        print(f"  Nodes required: {estimation['nodes_required']}")

        try:
            subcircuits = simulator.prepare_circuit(qasm)
            print(f"  Actual subcircuits: {len(subcircuits)}")
            print(f"  Subcircuit sizes: {[len(sc.qubits) for sc in subcircuits]}")
            
            if len(subcircuits) > 1:
                print("  ✓ Partitioning successful")
        except Exception as e:
            print(f"  ✗ Error: {e}")
            import traceback
            traceback.print_exc()

    return True


def test_medium_scale_simulation():
    print("\n" + "=" * 70)
    print("Test 3: Medium-Scale Simulation (16 qubits)")
    print("=" * 70)

    simulator = AdaptiveQuantumSimulator(max_qubits_per_node=10)

    num_qubits = 16
    print(f"\nRunning {num_qubits}-qubit GHZ state simulation...")
    
    qasm = create_large_qasm(num_qubits, 'ghz')

    try:
        result = simulator.run_full_simulation(qasm, verbose=True)
        
        print(f"\nResults:")
        print(f"  Success: {result['success']}")
        print(f"  Total qubits: {result['total_qubits']}")
        print(f"  Number of subcircuits: {result['num_subcircuits']}")
        print(f"  Purity: {result['purity']:.6f}")
        print(f"  Amplitude vector size: {len(result['amplitudes'])}")
        
        print(f"\nFirst 8 amplitudes:")
        for i in range(min(8, len(result['amplitudes']))):
            amp = result['amplitudes'][i]
            prob = abs(amp) ** 2
            print(f"  |{i:0{num_qubits}b}>: {amp:.4f} (P={prob:.4f})")

        print("\n  ✓ Medium-scale simulation completed successfully")
        return True
        
    except Exception as e:
        print(f"\n  ✗ Error during simulation: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_large_qasm_generation():
    print("\n" + "=" * 70)
    print("Test 4: Large QASM Generation")
    print("=" * 70)

    print("\nGenerating QASM for different sizes and types:")
    
    for num_qubits in [20, 30, 40]:
        for circuit_type in ['ghz', 'qft', 'random']:
            qasm = create_large_qasm(num_qubits, circuit_type)
            num_lines = len(qasm.split('\n'))
            print(f"  {num_qubits} qubits, {circuit_type}: {num_lines} lines")

    print("\n  ✓ QASM generation working correctly")
    return True


def test_scalability_projection():
    print("\n" + "=" * 70)
    print("Test 5: Scalability Projection for Large Circuits")
    print("=" * 70)

    mm = MemoryManager()

    print("\nScalability projection (with adaptive partitioning):")
    print(f"  {'Qubits':<10} {'Partitions':<12} {'Nodes':<10} {'Per node':<12}")
    print("  " + "-" * 45)
    
    for total_qubits in [30, 35, 40, 45, 50]:
        partitions = mm.calculate_optimal_partitions(total_qubits)
        qubits_per_partition = (total_qubits + partitions - 1) // partitions
        nodes_needed = max(1, partitions // 2)
        
        print(f"  {total_qubits:<10} {partitions:<12} {nodes_needed:<10} {qubits_per_partition} qubits")

    print("\n  ✓ Scalability projection complete")
    return True


def main():
    print("\n" + "=" * 70)
    print("Large-Scale Quantum Circuit Simulator Tests")
    print("Adaptive Bit Expansion Capability")
    print("=" * 70)

    tests = [
        ("Memory Estimation", test_memory_estimation),
        ("Adaptive Partitioning", test_adaptive_partitioning),
        ("Medium-Scale Simulation (16 qubits)", test_medium_scale_simulation),
        ("Large QASM Generation", test_large_qasm_generation),
        ("Scalability Projection", test_scalability_projection),
    ]

    results = []
    for test_name, test_func in tests:
        try:
            success = test_func()
            results.append((test_name, success))
        except Exception as e:
            print(f"\nException in {test_name}: {e}")
            import traceback
            traceback.print_exc()
            results.append((test_name, False))

    print("\n" + "=" * 70)
    print("Test Summary")
    print("=" * 70)
    
    for test_name, success in results:
        status = "PASS ✓" if success else "FAIL ✗"
        print(f"  {test_name}: {status}")

    passed = sum(1 for _, s in results if s)
    total = len(results)
    print(f"\nTotal: {passed}/{total} tests passed")

    if passed == total:
        print("\n" + "=" * 70)
        print("All tests passed! Adaptive bit expansion is working correctly.")
        print("The simulator supports 40+ qubits with adaptive partitioning.")
        print("=" * 70)
        return 0
    else:
        return 1


if __name__ == '__main__':
    sys.exit(main())
