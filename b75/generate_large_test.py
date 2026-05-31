#!/usr/bin/env python3

# 生成一个大的 FASTA 测试文件
pattern = "GATTACA" * 1000 + "ATCG" * 2000 + "GGGG" * 500 + "AAAA" * 500

with open("large_test.fasta", "w") as f:
    f.write(">large_sequence\n")
    for i in range(0, len(pattern), 80):
        f.write(pattern[i:i+80] + "\n")

print(f"生成了 large_test.fasta，长度: {len(pattern)} 碱基")
