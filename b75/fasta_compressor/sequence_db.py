import sqlite3
import os
from typing import List, Tuple, Optional, Dict
from contextlib import contextmanager


class SequenceDatabase:
    def __init__(self, db_path: str = "fasta_sequences.db"):
        self.db_path = db_path
        self._init_db()

    @contextmanager
    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def _init_db(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS sequences (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    seq_id TEXT UNIQUE NOT NULL,
                    header TEXT NOT NULL,
                    original_length INTEGER NOT NULL,
                    compressed_data BLOB NOT NULL,
                    compression_ratio REAL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS search_index (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sequence_id INTEGER NOT NULL,
                    kmer TEXT NOT NULL,
                    positions TEXT NOT NULL,
                    FOREIGN KEY (sequence_id) REFERENCES sequences(id) ON DELETE CASCADE,
                    UNIQUE(sequence_id, kmer)
                )
            ''')

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_seq_id ON sequences(seq_id)
            ''')

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_kmer ON search_index(kmer)
            ''')

            conn.commit()

    def add_sequence(self, seq_id: str, header: str, sequence: str, 
                     compressed_data: bytes, compression_ratio: float) -> int:
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute('''
                INSERT OR REPLACE INTO sequences 
                (seq_id, header, original_length, compressed_data, compression_ratio)
                VALUES (?, ?, ?, ?, ?)
            ''', (seq_id, header, len(sequence), compressed_data, compression_ratio))

            sequence_id = cursor.lastrowid

            k = 10
            kmer_positions = {}
            for i in range(len(sequence) - k + 1):
                kmer = sequence[i:i+k]
                if kmer in kmer_positions:
                    kmer_positions[kmer].append(i)
                else:
                    kmer_positions[kmer] = [i]

            for kmer, positions in kmer_positions.items():
                positions_str = ','.join(map(str, positions))
                cursor.execute('''
                    INSERT OR REPLACE INTO search_index 
                    (sequence_id, kmer, positions)
                    VALUES (?, ?, ?)
                ''', (sequence_id, kmer, positions_str))

            conn.commit()
            return sequence_id

    def get_sequence(self, seq_id: str) -> Optional[Tuple[str, bytes, int]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT header, compressed_data, original_length 
                FROM sequences WHERE seq_id = ?
            ''', (seq_id,))
            row = cursor.fetchone()
            if row:
                return (row['header'], row['compressed_data'], row['original_length'])
            return None

    def get_all_sequence_ids(self) -> List[str]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT seq_id FROM sequences ORDER BY seq_id')
            return [row['seq_id'] for row in cursor.fetchall()]

    def search_kmer_positions(self, kmer: str) -> Dict[str, List[int]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT s.seq_id, si.positions
                FROM search_index si
                JOIN sequences s ON s.id = si.sequence_id
                WHERE si.kmer = ?
            ''', (kmer,))

            results = {}
            for row in cursor.fetchall():
                positions = list(map(int, row['positions'].split(',')))
                results[row['seq_id']] = positions
            return results

    def delete_sequence(self, seq_id: str) -> bool:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM sequences WHERE seq_id = ?', (seq_id,))
            conn.commit()
            return cursor.rowcount > 0

    def get_statistics(self) -> Dict:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT 
                    COUNT(*) as total_sequences,
                    SUM(original_length) as total_bases,
                    AVG(compression_ratio) as avg_compression_ratio
                FROM sequences
            ''')
            row = cursor.fetchone()
            return {
                'total_sequences': row['total_sequences'] or 0,
                'total_bases': row['total_bases'] or 0,
                'avg_compression_ratio': row['avg_compression_ratio'] or 0.0
            }

    def clear_all(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM search_index')
            cursor.execute('DELETE FROM sequences')
            conn.commit()
