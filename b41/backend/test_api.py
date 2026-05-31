import requests
import json

print("Testing DNA Alignment API")
print("=" * 60)

print("\n1. Testing health endpoint...")
try:
    response = requests.get('http://localhost:8000/health', timeout=5)
    print(f"   Status: {response.status_code}")
    print(f"   Response: {response.json()}")
except Exception as e:
    print(f"   Error: {e}")

print("\n2. Testing upload endpoint...")
try:
    files = {
        'file1': ('sample1.fasta', open('../database/sample1.fasta', 'rb')),
        'file2': ('sample2.fasta', open('../database/sample2.fasta', 'rb'))
    }
    
    response = requests.post('http://localhost:8000/upload', files=files, timeout=30)
    print(f"   Status: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print(f"\n   Task ID: {data['task_id']}")
        print(f"   Score: {data['result']['score']}")
        print(f"\n   Progress:")
        for p in data['result']['progress']:
            print(f"      Step {p['step']}/{p['total']}: {p['message']}")
        print(f"\n   Aligned A length: {len(data['result']['aligned_a'])}")
        print(f"   Aligned B length: {len(data['result']['aligned_b'])}")
        print(f"\n   Alignment preview:")
        print(f"      Seq A:  {data['result']['aligned_a'][:60]}...")
        print(f"      Match:  {data['result']['alignment_string'][:60]}...")
        print(f"      Seq B:  {data['result']['aligned_b'][:60]}...")
    else:
        print(f"   Error response: {response.text}")

except Exception as e:
    print(f"   Error: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 60)
print("Test completed!")
