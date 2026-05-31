import time
from task_queue import TaskQueue


def producer():
    queue = TaskQueue()
    print("=== Producer: Adding tasks ===")

    queue.enqueue("low priority task", priority=-1)
    queue.enqueue("default priority task")
    queue.enqueue("high priority task", priority=1)
    queue.enqueue("another high priority task", priority=999)
    queue.enqueue("another low priority task", priority=-999)

    queue.enqueue("delayed task (3 seconds)", delay=3)
    queue.enqueue("high priority delayed task (2 seconds)", priority=1, delay=2)

    print("=== All tasks enqueued ===")


def producer_dlq():
    queue = TaskQueue()
    print("=== Producer: Adding tasks for DLQ test ===")

    queue.enqueue("task that may fail (1)")
    queue.enqueue("task that may fail (2)")
    queue.enqueue("task that may fail (3)")

    print("=== All tasks enqueued ===")


def consumer():
    queue = TaskQueue()
    queue.worker_loop()


def consumer_dlq():
    queue = TaskQueue()
    print("=== Consumer with 50% failure rate ===")
    queue.worker_loop(failure_rate=0.5)


def check_dlq():
    queue = TaskQueue()
    tasks = queue.get_dlq_tasks()
    print(f"\n=== DLQ Tasks (total: {len(tasks)}) ===")
    for t in tasks:
        print(f"  ID: {t['id']}, Data: {t['data']}, Retries: {t.get('retry_count', 0)}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "consumer":
            consumer()
        elif cmd == "consumer-dlq":
            consumer_dlq()
        elif cmd == "producer":
            producer()
        elif cmd == "producer-dlq":
            producer_dlq()
        elif cmd == "check-dlq":
            check_dlq()
        else:
            print("Usage:")
            print("  python example.py producer")
            print("  python example.py consumer")
            print("  python example.py producer-dlq")
            print("  python example.py consumer-dlq")
            print("  python example.py check-dlq")
    else:
        producer()
