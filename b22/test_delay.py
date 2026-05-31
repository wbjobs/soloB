import json
import time
import redis

r = redis.Redis(host="localhost", port=6379, db=15, decode_responses=True)
r.flushdb()

DELAY_KEY = "test:delay"

task1 = {"id": 1, "data": "task1"}
task2 = {"id": 2, "data": "task2"}

execute_at1 = time.time() + 2
execute_at2 = time.time() + 1

print(f"Adding task1 at {execute_at1}")
print(f"Adding task2 at {execute_at2}")

r.zadd(DELAY_KEY, {json.dumps(task1): execute_at1})
r.zadd(DELAY_KEY, {json.dumps(task2): execute_at2})

print("\nZSET content (with scores):")
all_items = r.zrange(DELAY_KEY, 0, -1, withscores=True)
for item, score in all_items:
    print(f"  {item} -> {score}")

print("\nWaiting for tasks to expire...")
time.sleep(1.5)

now = time.time()
print(f"\nNow: {now}")

print("Checking zrangebyscore('-inf', now):")
by_score = r.zrangebyscore(DELAY_KEY, "-inf", now, start=0, num=10)
print(f"  Result: {by_score}")

print("\nChecking zrange(0, 0, withscores=True):")
first = r.zrange(DELAY_KEY, 0, 0, withscores=True)
print(f"  Result: {first}")
