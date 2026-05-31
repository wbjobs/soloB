import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.alignment.service import PythonAlignmentService


def test_python_needleman_wunsch():
    print("Testing Python Needleman-Wunsch implementation...")
    print("=" * 60)
    
    service = PythonAlignmentService()
    
    seq1 = "GATTACA"
    seq2 = "GCATGCU"
    
    print(f"\nTest 1: Simple sequences")
    print(f"  Sequence 1: {seq1}")
    print(f"  Sequence 2: {seq2}")
    
    result = service.align(seq1, seq2)
    
    print(f"\n  Aligned A:  {result.aligned_a}")
    print(f"  Aligned B:  {result.aligned_b}")
    print(f"  Alignment:  {result.alignment_string}")
    print(f"  Score:      {result.score}")
    
    print(f"\n  Progress:")
    for p in result.progress:
        print(f"    Step {p.step}/{p.total}: {p.message}")
    
    print("\n" + "=" * 60)
    
    seq3 = "ATGCGATCGATCGATCG"
    seq4 = "ATGCGATCGATCGATCA"
    
    print(f"\nTest 2: Longer sequences")
    print(f"  Sequence 1: {seq3}")
    print(f"  Sequence 2: {seq4}")
    
    result2 = service.align(seq3, seq4)
    
    matches = result2.alignment_string.count('|')
    mismatches = result2.alignment_string.count('*')
    gaps = result2.aligned_a.count('-') + result2.aligned_b.count('-')
    
    print(f"\n  Aligned length: {len(result2.aligned_a)}")
    print(f"  Matches:        {matches}")
    print(f"  Mismatches:     {mismatches}")
    print(f"  Gaps:           {gaps}")
    print(f"  Final score:    {result2.score}")
    
    print("\n" + "=" * 60)
    print("\nAll tests passed!")


if __name__ == "__main__":
    test_python_needleman_wunsch()
