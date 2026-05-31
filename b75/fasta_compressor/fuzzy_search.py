from typing import List, Tuple, Dict
import re


class ImprovedShiftOr:
    BASE_MAP = {'A': 0, 'T': 1, 'G': 2, 'C': 3}

    def __init__(self, pattern: str, max_mismatches: int = 3):
        self.pattern = pattern.upper()
        self.max_mismatches = max_mismatches
        self.m = len(self.pattern)
        self._preprocess()

    def _preprocess(self):
        self.mask = {}
        for base in ['A', 'T', 'G', 'C']:
            self.mask[base] = 0
            for i in range(self.m):
                if self.pattern[i] != base:
                    self.mask[base] |= (1 << i)

    def search(self, text: str) -> List[Tuple[int, int, str]]:
        text = text.upper()
        n = len(text)
        results = []

        if self.m == 0 or n < self.m:
            return results

        states = [(1 << self.m) - 1] * (self.max_mismatches + 1)
        state_mask = (1 << self.m) - 1

        for i in range(n):
            if text[i] not in self.BASE_MAP:
                continue

            current_base = text[i]
            prev = states[0]
            states[0] = ((states[0] << 1) | 1) | self.mask[current_base]
            states[0] &= state_mask

            for k in range(1, self.max_mismatches + 1):
                temp = states[k]
                states[k] = ((states[k] << 1) | 1) | self.mask[current_base]
                states[k] &= state_mask
                states[k] &= ((prev << 1) | 1) & (prev << 1) & states[k-1]
                states[k] &= state_mask
                prev = temp

            for k in range(self.max_mismatches + 1):
                if (states[k] & (1 << (self.m - 1))) == 0:
                    start_pos = i - self.m + 1
                    if start_pos >= 0 and start_pos + self.m <= n:
                        matched = text[start_pos:i+1]
                        if len(matched) == self.m:
                            mismatches = sum(1 for a, b in zip(self.pattern, matched) if a != b)
                            if mismatches <= self.max_mismatches:
                                results.append((start_pos, mismatches, matched))

        return self._merge_overlapping(results)

    def _merge_overlapping(self, results: List[Tuple[int, int, str]]) -> List[Tuple[int, int, str]]:
        if not results:
            return []

        results.sort(key=lambda x: (x[0], x[1]))
        merged = [results[0]]

        for pos, mism, match in results[1:]:
            last_pos, last_mism, last_match = merged[-1]
            if pos - last_pos < self.m:
                if mism < last_mism:
                    merged[-1] = (pos, mism, match)
            else:
                merged.append((pos, mism, match))

        return merged


class FastFuzzySearcher:
    def __init__(self, sequence: str, chunk_size: int = 100000):
        self.sequence = sequence.upper()
        self.chunk_size = chunk_size
        self._build_kmer_index()

    def _build_kmer_index(self, k: int = 10):
        self.kmer_index = {}
        for i in range(len(self.sequence) - k + 1):
            kmer = self.sequence[i:i+k]
            if kmer in self.kmer_index:
                self.kmer_index[kmer].append(i)
            else:
                self.kmer_index[kmer] = [i]

    def _generate_seeds(self, pattern: str, seed_length: int = 10) -> List[Tuple[str, int]]:
        seeds = []
        n = len(pattern)
        if n < seed_length:
            return [(pattern, 0)]
        for i in range(n - seed_length + 1):
            seed = pattern[i:i+seed_length]
            seeds.append((seed, i))
        return seeds

    def search(self, pattern: str, max_mismatches: int = 3) -> List[Tuple[int, int, str]]:
        pattern = pattern.upper()
        pattern_len = len(pattern)
        seq_len = len(self.sequence)

        if pattern_len == 0 or seq_len < pattern_len:
            return []

        if pattern_len <= 20:
            searcher = ImprovedShiftOr(pattern, max_mismatches)
            return searcher.search(self.sequence)

        seeds = self._generate_seeds(pattern)
        candidate_positions = set()

        for seed, seed_offset in seeds:
            if seed in self.kmer_index:
                for pos in self.kmer_index[seed]:
                    candidate_pos = pos - seed_offset
                    if 0 <= candidate_pos <= seq_len - pattern_len:
                        candidate_positions.add(candidate_pos)

        results = []
        searcher = ImprovedShiftOr(pattern, max_mismatches)

        for candidate_pos in candidate_positions:
            start = max(0, candidate_pos - max_mismatches)
            end = min(seq_len, candidate_pos + pattern_len + max_mismatches)
            if end - start < pattern_len:
                continue
            window = self.sequence[start:end]

            window_results = searcher.search(window)
            for pos, mism, match in window_results:
                results.append((start + pos, mism, match))

        return results


class SequenceSearcher:
    def __init__(self):
        self.sequences = {}

    def add_sequence(self, seq_id: str, sequence: str):
        self.sequences[seq_id] = FastFuzzySearcher(sequence)

    def search_all(self, pattern: str, max_mismatches: int = 3) -> Dict[str, List[Tuple[int, int, str]]]:
        results = {}
        for seq_id, searcher in self.sequences.items():
            hits = searcher.search(pattern, max_mismatches)
            if hits:
                results[seq_id] = hits
        return results
