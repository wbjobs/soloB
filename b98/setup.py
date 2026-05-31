from setuptools import setup, find_packages

setup(
    name="distributed-quantum-simulator",
    version="0.1.0",
    description="Distributed Quantum Circuit Simulator with MPI support",
    author="Quantum Simulator Team",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    install_requires=[
        "numpy>=1.24.0",
        "scipy>=1.10.0",
        "mpi4py>=3.1.4",
        "networkx>=3.0",
        "qiskit>=0.43.0",
    ],
    python_requires=">=3.9",
    entry_points={
        "console_scripts": [
            "qsim=quantum_simulator.main:main",
        ],
    },
)
