#!/bin/bash
#SBATCH --job-name=quantum_sim
#SBATCH --output=quantum_sim_%j.out
#SBATCH --error=quantum_sim_%j.err
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=4
#SBATCH --cpus-per-task=1
#SBATCH --mem=8G
#SBATCH --time=02:00:00
#SBATCH --partition=compute

echo "Starting distributed quantum circuit simulation"
echo "Job ID: $SLURM_JOB_ID"
echo "Number of nodes: $SLURM_NNODES"
echo "Number of tasks: $SLURM_NTASKS"
echo "Tasks per node: $SLURM_NTASKS_PER_NODE"

INPUT_FILE=""
PARTITIONS=4
VERBOSE=true

while getopts "i:p:v" opt; do
  case $opt in
    i) INPUT_FILE="$OPTARG"
    ;;
    p) PARTITIONS="$OPTARG"
    ;;
    v) VERBOSE=true
    ;;
    \?) echo "Invalid option -$OPTARG" >&2
    ;;
  esac
done

echo "Partition count: $PARTITIONS"
echo "Input file: $INPUT_FILE"

cd $SLURM_SUBMIT_DIR

if [ -n "$VIRTUAL_ENV" ]; then
    echo "Using existing virtual environment: $VIRTUAL_ENV"
elif [ -d "venv" ]; then
    echo "Activating virtual environment"
    source venv/bin/activate
else
    echo "No virtual environment found, using system Python"
fi

echo "Python version:"
python3 --version

echo "Installed packages:"
pip3 list | grep -E "numpy|mpi4py|networkx"

CMD="mpirun -np $SLURM_NTASKS python3 -m quantum_simulator.main --partitions $PARTITIONS"

if [ -n "$INPUT_FILE" ]; then
    CMD="$CMD --input $INPUT_FILE"
fi

if [ "$VERBOSE" = true ]; then
    CMD="$CMD --verbose"
fi

echo "Executing: $CMD"
eval $CMD

echo "Simulation completed at: $(date)"
