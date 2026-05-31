import json
import random
import time
import redis


class TaskQueue:
    HIGH_KEY = "queue:high"
    DEFAULT_KEY = "queue:default"
    LOW_KEY = "queue:low"
    DELAY_QUEUE_KEY = "queue:delay"
    DLQ_KEY = "queue:dlq"
    MAX_RETRIES = 3
    RETRY_DELAY = 1

    def __init__(self, host="localhost", port=6379, db=0):
        self.redis = redis.Redis(host=host, port=port, db=db, decode_responses=True)

    def _priority_to_key(self, priority):
        if priority > 0:
            return self.HIGH_KEY
        elif priority < 0:
            return self.LOW_KEY
        return self.DEFAULT_KEY

    def _retry_or_dlq(self, task):
        task["retry_count"] = task.get("retry_count", 0) + 1
        task_json = json.dumps(task)

        if task["retry_count"] >= self.MAX_RETRIES:
            self.redis.rpush(self.DLQ_KEY, task_json)
            print(f"[Worker] Task {task['id']} moved to DLQ after {task['retry_count']} retries")
        else:
            queue_key = self._priority_to_key(task["priority"])
            execute_at = time.time() + self.RETRY_DELAY
            self.redis.zadd(self.DELAY_QUEUE_KEY, mapping={task_json: execute_at})
            print(f"[Worker] Task {task['id']} scheduled for retry {task['retry_count']}")

    def get_dlq_tasks(self):
        tasks_json = self.redis.lrange(self.DLQ_KEY, 0, -1)
        return [json.loads(t) for t in tasks_json]

    def enqueue(self, task_data, priority=0, delay=0):
        task = {
            "id": int(time.time() * 1000000),
            "data": task_data,
            "priority": priority,
            "created_at": time.time(),
            "retry_count": 0,
        }
        task_json = json.dumps(task)

        if delay > 0:
            execute_at = time.time() + delay
            self.redis.zadd(self.DELAY_QUEUE_KEY, mapping={task_json: execute_at})
        else:
            queue_key = self._priority_to_key(priority)
            self.redis.rpush(queue_key, task_json)

    def _schedule_due_tasks(self):
        now = time.time()
        scheduled = 0

        while True:
            due_tasks = self.redis.zrangebyscore(
                self.DELAY_QUEUE_KEY, "-inf", now, start=0, num=1
            )
            if not due_tasks:
                break

            task_json = due_tasks[0]
            removed = self.redis.zrem(self.DELAY_QUEUE_KEY, task_json)
            if removed:
                task = json.loads(task_json)
                queue_key = self._priority_to_key(task["priority"])
                self.redis.rpush(queue_key, task_json)
                scheduled += 1

        return scheduled

    def dequeue(self, timeout=0):
        self._schedule_due_tasks()

        result = self.redis.blpop(
            [self.HIGH_KEY, self.DEFAULT_KEY, self.LOW_KEY], timeout=timeout
        )
        if result:
            queue_key, task_json = result
            return json.loads(task_json)
        return None

    def worker_loop(self, poll_interval=1.0, failure_rate=0.0):
        print("Worker started, waiting for tasks...")
        try:
            while True:
                task = self.dequeue(timeout=poll_interval)
                if task:
                    retry_info = f" (retry {task.get('retry_count', 0)})" if task.get("retry_count", 0) > 0 else ""
                    print(
                        f"[Worker] Processing task {task['id']}: {task['data']} "
                        f"(priority={task['priority']}){retry_info}"
                    )
                    if failure_rate > 0 and random.random() < failure_rate:
                        print(f"[Worker] Task {task['id']} failed, handling retry...")
                        self._retry_or_dlq(task)
        except KeyboardInterrupt:
            print("\nWorker stopped.")
