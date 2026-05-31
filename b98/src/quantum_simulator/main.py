import argparse
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from quantum_simulator.qasm_parser import QASMParser
from quantum_simulator.circuit_cutter import CircuitCutter
from quantum_simulator.mpi_communicator import MPICommunicator, DistributedSimulator
from quantum_simulator.density_matrix import DensityMatrixSimulator
from quantum_simulator.result_merger import ResultMerger


def main():
    parser = argparse.ArgumentParser(description='Distributed Quantum Circuit Simulator')
    parser.add_argument('--input', '-i', type=str, help='Input OpenQASM file')
    parser.add_argument('--qasm', type=str, help='QASM string (alternative to file)')
    parser.add_argument('--partitions', '-p', type=int, default=2, help='Number of partitions')
    parser.add_argument('--output', '-o', type=str, default='results', help='Output file prefix')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    parser.add_argument('--no-mle', action='store_true', help='Disable Maximum Likelihood Estimation')
    parser.add_argument('--no-entanglement-cut', action='store_true', help='Disable entanglement-aware cutting')
    
    args = parser.parse_args()

    comm = MPICommunicator()
    
    if comm.is_master:
        print("=" * 60)
        print("Distributed Quantum Circuit Simulator")
        print(f"Number of MPI processes: {comm.get_size()}")
        print(f"Number of partitions: {args.partitions}")
        print(f"Entanglement-aware cutting: {'Disabled' if args.no_entanglement_cut else 'Enabled'}")
        print(f"MLE correction: {'Disabled' if args.no_mle else 'Enabled'}")
        print("=" * 60)
        
        qasm_parser = QASMParser()
        
        if args.qasm:
            circuit = qasm_parser.parse(args.qasm)
        elif args.input:
            circuit = qasm_parser.parse_file(args.input)
        else:
            default_qasm = '''
OPENQASM 3.0;
qreg q[4];
h q[0];
h q[1];
cx q[0], q[2];
cx q[1], q[3];
h q[2];
'''
            circuit = qasm_parser.parse(default_qasm)
        
        if args.verbose:
            print(f"\nParsed circuit: {circuit.num_qubits} qubits, {len(circuit.gates)} gates")
        
        cutter = CircuitCutter(num_partitions=args.partitions)
        use_entanglement = not args.no_entanglement_cut
        subcircuits = cutter.cut(circuit, use_entanglement_aware=use_entanglement)
        
        if args.verbose:
            print(f"\nGenerated {len(subcircuits)} subcircuits:")
            for sc in subcircuits:
                cut_info = f", cut_entropy={cutter.get_total_cut_entropy():.4f}" if use_entanglement else ""
                print(f"  Subcircuit {sc.subcircuit_id}: qubits={sc.qubits}, gates={len(sc.gates)}{cut_info}")
        
        comm.barrier()
        local_subcircuit = comm.scatter_subcircuits(subcircuits)
    else:
        comm.barrier()
        local_subcircuit = comm.scatter_subcircuits(None)

    if local_subcircuit:
        if args.verbose and comm.get_rank() < 10:
            print(f"Rank {comm.get_rank()}: Simulating subcircuit with qubits={local_subcircuit.qubits}")
        
        distributed_sim = DistributedSimulator(comm)
        distributed_sim.set_subcircuit(local_subcircuit)
        local_result = distributed_sim.run_simulation(DensityMatrixSimulator)
    else:
        local_result = {
            'rank': comm.get_rank(),
            'subcircuit_id': None,
            'qubits': [],
            'density_matrix': None,
            'external_qubits': []
        }

    all_results = comm.gather_results(local_result)

    if comm.is_master:
        valid_results = [r for r in all_results if r and r['density_matrix'] is not None]
        
        merger = ResultMerger(circuit.num_qubits)
        merger.add_results(valid_results)
        merger.set_partitions(cutter.best_partition)
        merger.merge(use_mle=not args.no_mle)
        
        if args.verbose:
            merger.print_summary()
        
        amplitude_vector = merger.get_amplitude_vector()
        
        print(f"\nFinal amplitude vector (first 10 elements):")
        for i in range(min(10, len(amplitude_vector))):
            print(f"  |{i:0{circuit.num_qubits}b}>: {amplitude_vector[i]:.6f}")
        
        merger.save_results(args.output)
        
        print("\nSimulation completed successfully!")

    comm.finalize()


if __name__ == '__main__':
    main()
