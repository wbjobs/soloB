from typing import List
from ..schemas.schemas import AlignmentResult, ProgressUpdate


class PythonAlignmentService:
    @staticmethod
    def align(
        sequence_a: str,
        sequence_b: str,
        match_score: int = 1,
        mismatch_score: int = -1,
        gap_score: int = -2
    ) -> AlignmentResult:
        progress: List[ProgressUpdate] = []
        progress.append(ProgressUpdate(
            step=1,
            total=4,
            message="初始化矩阵"
        ))

        m = len(sequence_a)
        n = len(sequence_b)
        
        dp = [[0] * (n + 1) for _ in range(m + 1)]
        
        for i in range(m + 1):
            dp[i][0] = gap_score * i
        for j in range(n + 1):
            dp[0][j] = gap_score * j

        progress.append(ProgressUpdate(
            step=2,
            total=4,
            message="填充矩阵"
        ))

        for i in range(1, m + 1):
            for j in range(1, n + 1):
                match_val = match_score if sequence_a[i-1] == sequence_b[j-1] else mismatch_score
                
                dp[i][j] = max(
                    dp[i-1][j-1] + match_val,
                    dp[i-1][j] + gap_score,
                    dp[i][j-1] + gap_score
                )

        progress.append(ProgressUpdate(
            step=3,
            total=4,
            message="回溯比对"
        ))

        i, j = m, n
        aligned_a = []
        aligned_b = []
        alignment_string = []

        while i > 0 and j > 0:
            current = dp[i][j]
            diagonal = dp[i-1][j-1]
            up = dp[i-1][j]
            left = dp[i][j-1]
            
            char_a = sequence_a[i-1]
            char_b = sequence_b[j-1]
            match_val = match_score if char_a == char_b else mismatch_score

            if current == diagonal + match_val:
                aligned_a.append(char_a)
                aligned_b.append(char_b)
                if char_a == char_b:
                    alignment_string.append('|')
                else:
                    alignment_string.append('*')
                i -= 1
                j -= 1
            elif current == up + gap_score:
                aligned_a.append(char_a)
                aligned_b.append('-')
                alignment_string.append(' ')
                i -= 1
            else:
                aligned_a.append('-')
                aligned_b.append(char_b)
                alignment_string.append(' ')
                j -= 1

        while i > 0:
            aligned_a.append(sequence_a[i-1])
            aligned_b.append('-')
            alignment_string.append(' ')
            i -= 1

        while j > 0:
            aligned_a.append('-')
            aligned_b.append(sequence_b[j-1])
            alignment_string.append(' ')
            j -= 1

        aligned_a_str = ''.join(reversed(aligned_a))
        aligned_b_str = ''.join(reversed(aligned_b))
        alignment_str = ''.join(reversed(alignment_string))

        progress.append(ProgressUpdate(
            step=4,
            total=4,
            message="完成比对"
        ))

        return AlignmentResult(
            aligned_a=aligned_a_str,
            aligned_b=aligned_b_str,
            alignment_string=alignment_str,
            score=dp[m][n],
            progress=progress
        )


def get_alignment_service():
    try:
        from .wasm.service import get_wasm_service
        wasm_service = get_wasm_service()
        return wasm_service
    except Exception as e:
        print(f"Wasm service not available, using Python fallback: {e}")
        return PythonAlignmentService()
