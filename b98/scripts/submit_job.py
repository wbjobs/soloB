#!/usr/bin/env python3
import subprocess
import argparse
import os
import sys


def generate_slurm_script(args):
    script_content = f'''#!/bin/bash
#SBATCH --job-name={args.job_name}
#SBATCH --output={args.output_dir}/{args.job_name}_%j.out
#SBATCH --error={args.output_dir}/{args.job_name}_%j.err
#SBATCH --nodes={args.nodes}
#SBATCH --ntasks-per-node={args.tasks_per_node}
#SBATCH --cpus-per-task={args.cpus_per_task}
#SBATCH --mem={args.mem}
#SBATCH --time={args.time}
#SBATCH --partition={args.partition}

echo "Starting distributed quantum circuit simulation"
echo "Job ID: $SLURM_JOB_ID"
echo "Number of nodes: $SLURM_NNODES"
echo "Number of tasks: $SLURM_NTASKS"

cd $SLURM_SUBMIT_DIR

'''

    if args.venv:
        script_content += f'source {args.venv}/bin/activate\n'

    if args.input:
        cmd = f'mpirun -np $SLURM_NTASKS python3 -m quantum_simulator.main --input {args.input} --partitions {args.partitions}'
    else:
        cmd = f'mpirun -np $SLURM_NTASKS python3 -m quantum_simulator.main --partitions {args.partitions}'

    if args.verbose:
        cmd += ' --verbose'

    script_content += f'\n{cmd}\n'
    script_content += '\necho "Simulation completed at: $(date)"\n'

    return script_content


def main():
    parser = argparse.ArgumentParser(description='Submit quantum simulation job to Slurm')
    parser.add_argument('--job-name', '-j', type=str, default='qsim', help='Job name')
    parser.add_argument('--nodes', '-n', type=int, default=2, help='Number of nodes')
    parser.add_argument('--tasks-per-node', '-t', type=int, default=4, help='Tasks per node')
    parser.add_argument('--cpus-per-task', '-c', type=int, default=1, help='CPUs per task')
    parser.add_argument('--mem', '-m', type=str, default='8G', help='Memory per node')
    parser.add_argument('--time', type=str, default='02:00:00', help='Wall time limit')
    parser.add_argument('--partition', '-p', type=str, default='compute', help='Slurm partition')
    parser.add_argument('--input', '-i', type=str, help='Input QASM file')
    parser.add_argument('--partitions', type=int, default=4, help='Number of circuit partitions')
    parser.add_argument('--output-dir', '-o', type=str, default='slurm_output', help='Output directory')
    parser.add_argument('--venv', type=str, help='Path to virtual environment')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    parser.add_argument('--dry-run', action='store_true', help='Generate script but do not submit')
    parser.add_argument('--script-only', action='store_true', help='Only save script, do not submit')

    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    script = generate_slurm_script(args)
    script_path = os.path.join(args.output_dir, f'{args.job_name}_submit.sh')

    with open(script_path, 'w') as f:
        f.write(script)

    os.chmod(script_path, 0o755)

    print(f'Slurm submission script generated: {script_path}')

    if args.dry_run or args.script_only:
        print('\nScript content:')
        print('=' * 60)
        print(script)
        print('=' * 60)
        return

    try:
        result = subprocess.run(['sbatch', script_path], capture_output=True, text=True)
        if result.returncode == 0:
            print(f'Job submitted successfully!')
            print(result.stdout.strip())
        else:
            print(f'Job submission failed:')
            print(result.stderr.strip())
            sys.exit(1)
    except FileNotFoundError:
        print('Error: sbatch command not found. Is Slurm installed?')
        sys.exit(1)


if __name__ == '__main__':
    main()
