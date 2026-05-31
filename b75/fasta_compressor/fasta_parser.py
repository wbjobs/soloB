from typing import List, Tuple, Optional
import re


class FastaRecord:
    def __init__(self, header: str, sequence: str):
        self.header = header
        self.sequence = sequence.upper()
        self.id = self._extract_id()

    def _extract_id(self) -> str:
        match = re.match(r'^>(\S+)', self.header)
        return match.group(1) if match else self.header[1:50]

    def __len__(self) -> int:
        return len(self.sequence)

    def __repr__(self) -> str:
        return f"FastaRecord(id={self.id}, length={len(self)})"


class FastaParser:
    VALID_BASES = {'A', 'T', 'G', 'C', 'N', 'R', 'Y', 'S', 'W', 'K', 'M', 'B', 'D', 'H', 'V'}

    @staticmethod
    def parse(file_path: str) -> List[FastaRecord]:
        records = []
        current_header = None
        current_sequence = []

        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue

                if line.startswith('>'):
                    if current_header is not None:
                        records.append(FastaRecord(current_header, ''.join(current_sequence)))
                    current_header = line
                    current_sequence = []
                else:
                    if current_header is None:
                        raise ValueError(f"Invalid FASTA format: sequence without header")
                    current_sequence.append(line)

            if current_header is not None:
                records.append(FastaRecord(current_header, ''.join(current_sequence)))

        return records

    @staticmethod
    def validate_sequence(sequence: str) -> bool:
        return all(base in FastaParser.VALID_BASES for base in sequence.upper())

    @staticmethod
    def write(records: List[FastaRecord], file_path: str, line_width: int = 80) -> None:
        with open(file_path, 'w', encoding='utf-8') as f:
            for record in records:
                f.write(f"{record.header}\n")
                seq = record.sequence
                for i in range(0, len(seq), line_width):
                    f.write(f"{seq[i:i+line_width]}\n")
