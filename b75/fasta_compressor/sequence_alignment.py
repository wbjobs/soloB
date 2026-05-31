from typing import List, Tuple, Dict, Any
import json
from collections import defaultdict


class SequenceAlignment:
    BASE_COLORS = {
        'A': '\033[92m',
        'T': '\033[91m',
        'G': '\033[93m',
        'C': '\033[94m',
        'N': '\033[95m',
        '-': '\033[90m',
        'RESET': '\033[0m'
    }

    MATCH_SYMBOL = '│'
    MISMATCH_SYMBOL = '╳'
    GAP_SYMBOL = '─'

    def __init__(self, match_score: int = 2, mismatch_score: int = -1, gap_penalty: int = -2):
        self.match_score = match_score
        self.mismatch_score = mismatch_score
        self.gap_penalty = gap_penalty

    def needleman_wunsch(self, seq1: str, seq2: str) -> Tuple[str, str, str]:
        n, m = len(seq1), len(seq2)
        dp = [[0] * (m + 1) for _ in range(n + 1)]

        for i in range(n + 1):
            dp[i][0] = i * self.gap_penalty
        for j in range(m + 1):
            dp[0][j] = j * self.gap_penalty

        for i in range(1, n + 1):
            for j in range(1, m + 1):
                match = dp[i-1][j-1] + (self.match_score if seq1[i-1] == seq2[j-1] else self.mismatch_score)
                delete = dp[i-1][j] + self.gap_penalty
                insert = dp[i][j-1] + self.gap_penalty
                dp[i][j] = max(match, delete, insert)

        align1, align2, align_match = [], [], []
        i, j = n, m

        while i > 0 or j > 0:
            if i > 0 and j > 0 and dp[i][j] == dp[i-1][j-1] + (self.match_score if seq1[i-1] == seq2[j-1] else self.mismatch_score):
                align1.append(seq1[i-1])
                align2.append(seq2[j-1])
                if seq1[i-1] == seq2[j-1]:
                    align_match.append(self.MATCH_SYMBOL)
                else:
                    align_match.append(self.MISMATCH_SYMBOL)
                i -= 1
                j -= 1
            elif i > 0 and dp[i][j] == dp[i-1][j] + self.gap_penalty:
                align1.append(seq1[i-1])
                align2.append('-')
                align_match.append(self.GAP_SYMBOL)
                i -= 1
            else:
                align1.append('-')
                align2.append(seq2[j-1])
                align_match.append(self.GAP_SYMBOL)
                j -= 1

        return ''.join(reversed(align1)), ''.join(reversed(align_match)), ''.join(reversed(align2))

    def find_differences(self, aligned1: str, aligned_match: str, aligned2: str) -> List[Dict[str, Any]]:
        differences = []
        pos1, pos2 = 0, 0

        for i, (a, m, b) in enumerate(zip(aligned1, aligned_match, aligned2)):
            if a != '-':
                pos1 += 1
            if b != '-':
                pos2 += 1

            if m != self.MATCH_SYMBOL:
                diff_type = 'substitution' if a != '-' and b != '-' else ('deletion' if b == '-' else 'insertion')
                differences.append({
                    'alignment_position': i,
                    'sequence1_position': pos1 if a != '-' else None,
                    'sequence2_position': pos2 if b != '-' else None,
                    'base1': a,
                    'base2': b,
                    'type': diff_type
                })

        return differences

    def calculate_mutation_stats(self, aligned1: str, aligned2: str) -> Dict[str, Any]:
        matches = sum(1 for a, b in zip(aligned1, aligned2) if a == b and a != '-')
        mismatches = sum(1 for a, b in zip(aligned1, aligned2) if a != b and a != '-' and b != '-')
        gaps1 = aligned1.count('-')
        gaps2 = aligned2.count('-')
        total_length = len(aligned1)

        identity = (matches / total_length * 100) if total_length > 0 else 0

        return {
            'alignment_length': total_length,
            'matches': matches,
            'mismatches': mismatches,
            'total_gaps': gaps1 + gaps2,
            'gaps_in_sequence1': gaps1,
            'gaps_in_sequence2': gaps2,
            'identity_percentage': round(identity, 2),
            'match_score': matches * self.match_score + mismatches * self.mismatch_score + (gaps1 + gaps2) * self.gap_penalty
        }

    def generate_heatmap_data(self, aligned1: str, aligned2: str, window_size: int = 10) -> Dict[str, Any]:
        mutation_density = []
        total_length = len(aligned1)

        for i in range(0, total_length, window_size):
            window_end = min(i + window_size, total_length)
            window1 = aligned1[i:window_end]
            window2 = aligned2[i:window_end]

            mutations = sum(1 for a, b in zip(window1, window2) if a != b)
            density = mutations / len(window1) if len(window1) > 0 else 0

            mutation_density.append({
                'window_start': i,
                'window_end': window_end - 1,
                'mutation_count': mutations,
                'window_size': len(window1),
                'density': round(density, 4)
            })

        per_base_mutation = [1 if a != b else 0 for a, b in zip(aligned1, aligned2)]

        return {
            'window_size': window_size,
            'mutation_density': mutation_density,
            'per_base_mutation': per_base_mutation
        }

    def generate_ascii_heatmap(self, aligned1: str, aligned_match: str, aligned2: str, 
                               line_width: int = 80, show_colors: bool = True) -> str:
        lines = []
        total_length = len(aligned1)

        lines.append("=" * (line_width + 20))
        lines.append("DNA 序列突变热力图")
        lines.append("=" * (line_width + 20))
        lines.append("")

        for start in range(0, total_length, line_width):
            end = min(start + line_width, total_length)

            lines.append(f"位置 {start:5d} - {end:5d}:")
            lines.append("")

            if show_colors:
                seq1_colored = ''.join(self.BASE_COLORS.get(b, self.BASE_COLORS['RESET']) + b + self.BASE_COLORS['RESET'] 
                                        for b in aligned1[start:end])
                lines.append(f"序列1: {seq1_colored}")
            else:
                lines.append(f"序列1: {aligned1[start:end]}")

            lines.append(f"       {aligned_match[start:end]}")

            if show_colors:
                seq2_colored = ''.join(self.BASE_COLORS.get(b, self.BASE_COLORS['RESET']) + b + self.BASE_COLORS['RESET'] 
                                        for b in aligned2[start:end])
                lines.append(f"序列2: {seq2_colored}")
            else:
                lines.append(f"序列2: {aligned2[start:end]}")

            density_line = []
            for i in range(start, end):
                if aligned_match[i] == self.MATCH_SYMBOL:
                    density_line.append(' ')
                elif aligned_match[i] == self.MISMATCH_SYMBOL:
                    density_line.append('█')
                else:
                    density_line.append('░')
            lines.append(f"突变: {''.join(density_line)}")
            lines.append("")

        legend = [
            "图例:",
            f"  {self.MATCH_SYMBOL} = 匹配",
            f"  {self.MISMATCH_SYMBOL} = 错配",
            f"  {self.GAP_SYMBOL} = 缺口",
            "  █ = 突变位置",
            "  ░ = 缺口位置",
            "",
            "碱基颜色:",
            f"  {self.BASE_COLORS['A']}A{self.BASE_COLORS['RESET']} = 腺嘌呤",
            f"  {self.BASE_COLORS['T']}T{self.BASE_COLORS['RESET']} = 胸腺嘧啶",
            f"  {self.BASE_COLORS['G']}G{self.BASE_COLORS['RESET']} = 鸟嘌呤",
            f"  {self.BASE_COLORS['C']}C{self.BASE_COLORS['RESET']} = 胞嘧啶",
        ]
        lines.extend(legend)

        return '\n'.join(lines)

    def align_and_analyze(self, seq1: str, seq2: str, window_size: int = 10, 
                          show_colors: bool = True) -> Dict[str, Any]:
        aligned1, aligned_match, aligned2 = self.needleman_wunsch(seq1, seq2)
        differences = self.find_differences(aligned1, aligned_match, aligned2)
        stats = self.calculate_mutation_stats(aligned1, aligned2)
        heatmap_data = self.generate_heatmap_data(aligned1, aligned2, window_size)
        ascii_heatmap = self.generate_ascii_heatmap(aligned1, aligned_match, aligned2, show_colors=show_colors)

        return {
            'alignment': {
                'sequence1': aligned1,
                'match_line': aligned_match,
                'sequence2': aligned2
            },
            'differences': differences,
            'statistics': stats,
            'heatmap_data': heatmap_data,
            'ascii_heatmap': ascii_heatmap
        }

    def export_json(self, result: Dict[str, Any], include_heatmap: bool = False) -> str:
        export_data = {
            'alignment': result['alignment'],
            'differences': result['differences'],
            'statistics': result['statistics'],
            'heatmap_data': result['heatmap_data']
        }
        if include_heatmap:
            export_data['ascii_heatmap'] = result['ascii_heatmap']
        return json.dumps(export_data, indent=2, ensure_ascii=False)
