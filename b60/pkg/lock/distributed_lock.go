package lock

import (
	"context"
	"time"

	clientv3 "go.etcd.io/etcd/client/v3"
)

type DistributedLock struct {
	client   *clientv3.Client
	key      string
	value    string
	leaseID  clientv3.LeaseID
}

type DistributedLockManager struct {
	client *clientv3.Client
}

func NewDistributedLockManager(endpoints []string) (*DistributedLockManager, error) {
	client, err := clientv3.New(clientv3.Config{
		Endpoints:   endpoints,
		DialTimeout: 5 * time.Second,
	})
	if err != nil {
		return nil, err
	}
	return &DistributedLockManager{client: client}, nil
}

func NewDistributedLockManagerFromClient(client *clientv3.Client) *DistributedLockManager {
	return &DistributedLockManager{client: client}
}

func (m *DistributedLockManager) Close() error {
	return m.client.Close()
}

func (m *DistributedLockManager) NewLock(key, value string) *DistributedLock {
	return &DistributedLock{
		client: m.client,
		key:    key,
		value:  value,
	}
}

func (l *DistributedLock) TryLock(ctx context.Context, ttl int64) (bool, error) {
	lease, err := l.client.Grant(ctx, ttl)
	if err != nil {
		return false, err
	}

	txn := l.client.Txn(ctx).
		If(clientv3.Compare(clientv3.CreateRevision(l.key), "=", 0)).
		Then(clientv3.OpPut(l.key, l.value, clientv3.WithLease(lease.ID))).
		Else(clientv3.OpGet(l.key))

	resp, err := txn.Commit()
	if err != nil {
		_, _ = l.client.Revoke(ctx, lease.ID)
		return false, err
	}

	if resp.Succeeded {
		l.leaseID = lease.ID
		return true, nil
	}

	_, _ = l.client.Revoke(ctx, lease.ID)
	return false, nil
}

func (l *DistributedLock) Lock(ctx context.Context, ttl int64, retryInterval time.Duration) error {
	for {
		ok, err := l.TryLock(ctx, ttl)
		if err != nil {
			return err
		}
		if ok {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(retryInterval):
		}
	}
}

func (l *DistributedLock) Unlock(ctx context.Context) error {
	if l.leaseID == 0 {
		return nil
	}

	_, err := l.client.Revoke(ctx, l.leaseID)
	if err != nil {
		return err
	}

	l.leaseID = 0
	return nil
}

func (l *DistributedLock) KeepAlive(ctx context.Context) (<-chan *clientv3.LeaseKeepAliveResponse, error) {
	if l.leaseID == 0 {
		return nil, nil
	}
	return l.client.KeepAlive(ctx, l.leaseID)
}
