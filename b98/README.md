# Distributed Quantum Circuit Simulator

A parallel quantum circuit simulator using MPI and density matrix representation.

## Features

1. **OpenQASM 3.0 Parser** - Parse quantum circuits in OpenQASM 3.0 format
2. **Circuit Cutting** - Partition quantum circuits based on qubit interaction graph
3. **MPI Distribution** - Distribute subcircuits across multiple compute nodes
4. **Density Matrix Simulation** - Each node simulates its subcircuit using density matrix
5. **Fidelity Calculation** - Calculate fidelity when merging results
6. **Amplitude Vector Output** - Extract and output the final quantum state amplitude vector
7. **Slurm Integration** - Support for HPC cluster job scheduling

## Installation

### Requirements

- Python 3.9+
- numpy
- scipy
- mpi4py
- networkx

### Install Dependencies

```bash
pip install -r requirements.txt
```

Or install in development mode:

```bash
pip install -e .
```

## Usage

### Single Node Execution

```bash
# Run with default circuit
python -m quantum_simulator.main --verbose

# Run with a QASM file
python -m quantum_simulator.main --input examples/ghz_state.qasm --partitions 2 --verbose
```

### MPI Parallel Execution

```bash
# Run with 4 MPI processes
mpirun -np 4 python -m quantum_simulator.main --input examples/ghz_state.qasm --partitions 4 --verbose
```

### Slurm HPC Cluster

Use the submission script:

```bash
# Generate and submit job
python scripts/submit_job.py --input examples/qft_4.qasm --nodes 2 --tasks-per-node 4 --partitions 8

# Dry run (only generate script, don't submit)
python scripts/submit_job.py --dry-run

# Just save the submission script
python scripts/submit_job.py --script-only
```

Or use the bash script directly:

```bash
sbatch scripts/run_simulation.sh -i examples/ghz_state.qasm -p 4
```

### Command Line Options

```
--input, -i        : Input OpenQASM file
--qasm              : QASM string (alternative to file)
--partitions, -p   : Number of circuit partitions (default: 2)
--output, -o       : Output file prefix (default: 'results')
--verbose, -v      : Verbose output
```

## Running Tests

```bash
python tests/test_basic.py
```

## Project Structure

```
distributed-quantum-simulator/
├── src/
│   └── quantum_simulator/
│       ├── __init__.py          # Package initialization
│       ├── qasm_parser.py       # OpenQASM 3.0 parser
│       ├── circuit_cutter.py    # Circuit cutting algorithm
│       ├── density_matrix.py    # Density matrix simulator
│       ├── mpi_communicator.py  # MPI communication wrapper
│       ├── result_merger.py     # Result merging and fidelity calculation
│       └── main.py              # Main entry point
├── examples/
│   ├── ghz_state.qasm           # 4-qubit GHZ state
│   └── qft_4.qasm               # 4-qubit Quantum Fourier Transform
├── scripts/
│   ├── run_simulation.sh        # Bash Slurm submission script
│   └── submit_job.py            # Python Slurm submission script
├── tests/
│   └── test_basic.py            # Basic functionality tests
├── requirements.txt             # Python dependencies
├── setup.py                     # Package setup
└── README.md                    # This file
```

## Output Files

The simulator generates:
- `results.npz` - Contains density matrix, amplitude vector, probabilities, and fidelity

## Example Circuits

### GHZ State
The GHZ (Greenberger-Horne-Zeilinger) state is a highly entangled quantum state:
```
|GHZ⟩ = (|0000⟩ + |1111⟩) / √2
```

### Quantum Fourier Transform (QFT)
The QFT is an important quantum algorithm used in many applications including Shor's algorithm.

## License

MIT License
