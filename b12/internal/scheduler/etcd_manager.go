package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path"
	"sync"
	"time"

	"dtsplatform/internal/config"

	clientv3 "go.etcd.io/etcd/client/v3"
	"go.etcd.io/etcd/client/v3/concurrency"
)

const (
	leaderKey        = "/dts/scheduler/leader"
	jobsKey          = "/dts/jobs/"
	tasksKey         = "/dts/tasks/"
	executorsKey     = "/dts/executors/"
	executionKey     = "/dts/executions/"
)

type EtcdManager struct {
	client    *clientv3.Client
	cfg       *config.Config
	session   *concurrency.Session
	election  *concurrency.Election
	isLeader  bool
	leaderMu  sync.RWMutex
	onLeader  func()
	onFollower func()
}

func NewEtcdManager(cfg *config.Config) (*EtcdManager, error) {
	client, err := clientv3.New(clientv3.Config{
		Endpoints:   cfg.Scheduler.EtcdEndpoints,
		DialTimeout: 5 * time.Second,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to etcd: %w", err)
	}

	return &EtcdManager{
		client: client,
		cfg:    cfg,
	}, nil
}

func (em *EtcdManager) Close() error {
	if em.session != nil {
		em.session.Close()
	}
	return em.client.Close()
}

func (em *EtcdManager) StartElection(ctx context.Context) error {
	session, err := concurrency.NewSession(em.client,
		concurrency.WithTTL(em.cfg.Scheduler.ElectionTTL))
	if err != nil {
		return fmt.Errorf("failed to create etcd session: %w", err)
	}
	em.session = session

	em.election = concurrency.NewElection(session, leaderKey)

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			default:
				if err := em.election.Campaign(ctx, em.cfg.Scheduler.Name); err != nil {
					log.Printf("Election error: %v, retrying...", err)
					time.Sleep(1 * time.Second)
					continue
				}
				em.setLeader(true)
				log.Printf("Became leader: %s", em.cfg.Scheduler.Name)

				if em.onLeader != nil {
					em.onLeader()
				}

				select {
				case <-em.session.Done():
					em.setLeader(false)
					log.Printf("Lost leadership: %s", em.cfg.Scheduler.Name)
					if em.onFollower != nil {
						em.onFollower()
					}
					time.Sleep(1 * time.Second)
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return nil
}

func (em *EtcdManager) SetLeaderCallbacks(onLeader, onFollower func()) {
	em.onLeader = onLeader
	em.onFollower = onFollower
}

func (em *EtcdManager) IsLeader() bool {
	em.leaderMu.RLock()
	defer em.leaderMu.RUnlock()
	return em.isLeader
}

func (em *EtcdManager) setLeader(leader bool) {
	em.leaderMu.Lock()
	defer em.leaderMu.Unlock()
	em.isLeader = leader
}

func (em *EtcdManager) GetLeader(ctx context.Context) (string, error) {
	resp, err := em.election.Leader(ctx)
	if err != nil {
		return "", err
	}
	return string(resp.Kvs[0].Value), nil
}

func (em *EtcdManager) PutJob(ctx context.Context, jobID string, data []byte) error {
	_, err := em.client.Put(ctx, jobsKey+jobID, string(data))
	return err
}

func (em *EtcdManager) GetJob(ctx context.Context, jobID string) ([]byte, error) {
	resp, err := em.client.Get(ctx, jobsKey+jobID)
	if err != nil {
		return nil, err
	}
	if len(resp.Kvs) == 0 {
		return nil, fmt.Errorf("job not found: %s", jobID)
	}
	return resp.Kvs[0].Value, nil
}

func (em *EtcdManager) ListJobs(ctx context.Context) (map[string][]byte, error) {
	resp, err := em.client.Get(ctx, jobsKey, clientv3.WithPrefix())
	if err != nil {
		return nil, err
	}
	jobs := make(map[string][]byte)
	for _, kv := range resp.Kvs {
		id := path.Base(string(kv.Key))
		jobs[id] = kv.Value
	}
	return jobs, nil
}

func (em *EtcdManager) DeleteJob(ctx context.Context, jobID string) error {
	_, err := em.client.Delete(ctx, jobsKey+jobID)
	return err
}

func (em *EtcdManager) RegisterExecutor(ctx context.Context, executorID string, data []byte, ttl int64) (clientv3.LeaseID, error) {
	if ttl <= 0 {
		ttl = 5
	}
	lease, err := em.client.Grant(ctx, ttl)
	if err != nil {
		return 0, err
	}
	_, err = em.client.Put(ctx, executorsKey+executorID, string(data), clientv3.WithLease(lease.ID))
	return lease.ID, err
}

func (em *EtcdManager) KeepAliveExecutor(ctx context.Context, leaseID clientv3.LeaseID) error {
	ch, err := em.client.KeepAlive(ctx, leaseID)
	if err != nil {
		return err
	}
	go func() {
		for range ch {
		}
	}()
	return nil
}

func (em *EtcdManager) ListExecutors(ctx context.Context) (map[string][]byte, error) {
	resp, err := em.client.Get(ctx, executorsKey, clientv3.WithPrefix())
	if err != nil {
		return nil, err
	}
	executors := make(map[string][]byte)
	for _, kv := range resp.Kvs {
		id := path.Base(string(kv.Key))
		executors[id] = kv.Value
	}
	return executors, nil
}

func (em *EtcdManager) WatchExecutors(ctx context.Context) clientv3.WatchChan {
	return em.client.Watch(ctx, executorsKey, clientv3.WithPrefix())
}

func (em *EtcdManager) AcquireTask(ctx context.Context, taskID, executorID string) (bool, error) {
	txn := em.client.Txn(ctx)
	txn.If(
		clientv3.Compare(clientv3.CreateRevision(tasksKey+taskID+"/owner"), "=", 0),
	).Then(
		clientv3.OpPut(tasksKey+taskID+"/owner", executorID, clientv3.WithLease(em.session.Lease())),
	)
	resp, err := txn.Commit()
	if err != nil {
		return false, err
	}
	return resp.Succeeded, nil
}

func (em *EtcdManager) ReleaseTask(ctx context.Context, taskID string) error {
	_, err := em.client.Delete(ctx, tasksKey+taskID+"/owner")
	return err
}

func (em *EtcdManager) UpdateTaskStatus(ctx context.Context, taskID string, data any) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = em.client.Put(ctx, tasksKey+taskID+"/status", string(jsonData))
	return err
}
