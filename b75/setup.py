from setuptools import setup, find_packages

setup(
    name="fasta-compressor",
    version="1.0.0",
    packages=find_packages(),
    install_requires=[
        "fastapi==0.104.1",
        "uvicorn==0.24.0",
        "click==8.1.7",
        "pydantic==2.5.0",
    ],
    entry_points={
        "console_scripts": [
            "fasta-cli=fasta_cli:cli",
        ],
    },
    python_requires=">=3.8",
)
