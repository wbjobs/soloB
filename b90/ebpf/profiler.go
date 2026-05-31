package ebpf

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/perf"
	"github.com/cilium/ebpf/ringbuf"
)

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -cflags "-O2 -g -Wall" bpf profiler.c

type EventType uint32

const (
	EventIORead    EventType = 1
	EventIOWrite   EventType = 2
	EventMemAlloc  EventType = 3
	EventTCPTx     EventType = 4
	EventTCPRx     EventType = 5
	EventLockWait  EventType = 6
)

type BPFEvent struct {
	Timestamp  uint64
	PID        uint32
	TID        uint32
	Comm       [16]byte
	EventType  uint32
	DurationNs uint64
	Bytes      uint64
	Address    uint64
	Retval     int32
	Filename   [256]byte
	StackID    uint64
}

type ProcessMetrics struct {
	PID            uint32
	IOReadBytes    uint64
	IOWriteBytes   uint64
	PageCacheHits  uint64
	TCPTxBytes     uint64
	TCPRxBytes     uint64
}

type BPFProfiler struct {
	objs         bpfObjects
	links        []link.Link
	ringbuf      *ringbuf.Reader
	eventChan    chan BPFEvent
	metricsChan  chan ProcessMetrics
	stopChan     chan struct{}
}

func NewBPFProfiler() (*BPFProfiler, error) {
	objs := bpfObjects{}
	if err := loadBpfObjects(&objs, nil); err != nil {
		return nil, fmt.Errorf("loading objects: %v", err)
	}

	profiler := &BPFProfiler{
		objs:        objs,
		eventChan:   make(chan BPFEvent, 1024),
		metricsChan: make(chan ProcessMetrics, 1024),
		stopChan:    make(chan struct{}),
	}

	if err := profiler.attachKprobes(); err != nil {
		objs.Close()
		return nil, err
	}

	rb, err := ringbuf.NewReader(objs.Events)
	if err != nil {
		objs.Close()
		return nil, fmt.Errorf("creating ringbuf reader: %v", err)
	}
	profiler.ringbuf = rb

	go profiler.pollEvents()
	go profiler.collectMetrics()

	return profiler, nil
}

func (p *BPFProfiler) attachKprobes() error {
	kp, err := link.Kprobe("vfs_read", p.objs.KprobeVfsRead, nil)
	if err != nil {
		return fmt.Errorf("attaching vfs_read: %v", err)
	}
	p.links = append(p.links, kp)

	kp, err = link.Kretprobe("vfs_read", p.objs.KretprobeVfsRead, nil)
	if err != nil {
		return fmt.Errorf("attaching vfs_read ret: %v", err)
	}
	p.links = append(p.links, kp)

	kp, err = link.Kprobe("vfs_write", p.objs.KprobeVfsWrite, nil)
	if err != nil {
		return fmt.Errorf("attaching vfs_write: %v", err)
	}
	p.links = append(p.links, kp)

	kp, err = link.Kretprobe("vfs_write", p.objs.KretprobeVfsWrite, nil)
	if err != nil {
		return fmt.Errorf("attaching vfs_write ret: %v", err)
	}
	p.links = append(p.links, kp)

	kp, err = link.Kprobe("__kmalloc", p.objs.KprobeKmalloc, nil)
	if err != nil {
		return fmt.Errorf("attaching kmalloc: %v", err)
	}
	p.links = append(p.links, kp)

	kp, err = link.Kretprobe("__kmalloc", p.objs.KretprobeKmalloc, nil)
	if err != nil {
		return fmt.Errorf("attaching kmalloc ret: %v", err)
	}
	p.links = append(p.links, kp)

	kp, err = link.Kprobe("tcp_sendmsg", p.objs.KprobeTcpSendmsg, nil)
	if err != nil {
		return fmt.Errorf("attaching tcp_sendmsg: %v", err)
	}
	p.links = append(p.links, kp)

	kp, err = link.Kprobe("tcp_recvmsg", p.objs.KprobeTcpRecvmsg, nil)
	if err != nil {
		return fmt.Errorf("attaching tcp_recvmsg: %v", err)
	}
	p.links = append(p.links, kp)

	kp, err = link.Kprobe("mutex_lock", p.objs.KprobeMutexLock, nil)
	if err != nil {
		return fmt.Errorf("attaching mutex_lock: %v", err)
	}
	p.links = append(p.links, kp)

	kp, err = link.Kretprobe("mutex_lock", p.objs.KretprobeMutexLock, nil)
	if err != nil {
		return fmt.Errorf("attaching mutex_lock ret: %v", err)
	}
	p.links = append(p.links, kp)

	return nil
}

func (p *BPFProfiler) pollEvents() {
	for {
		select {
		case <-p.stopChan:
			return
		default:
			record, err := p.ringbuf.Read()
			if err != nil {
				if err == ringbuf.ErrClosed {
					return
				}
				continue
			}

			var event BPFEvent
			if err := binary.Read(bytes.NewBuffer(record.RawSample), binary.LittleEndian, &event); err != nil {
				continue
			}

			p.eventChan <- event
		}
	}
}

func (p *BPFProfiler) collectMetrics() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-p.stopChan:
			return
		case <-ticker.C:
			var pid uint32
			iter := p.objs.ProcessIoRead.Iterate()
			for iter.Next(&pid, nil) {
				var readBytes, writeBytes, cacheHits, txBytes, rxBytes uint64
				
				p.objs.ProcessIoRead.Lookup(&pid, &readBytes)
				p.objs.ProcessIoWrite.Lookup(&pid, &writeBytes)
				p.objs.ProcessPageCache.Lookup(&pid, &cacheHits)
				p.objs.TcpTxBytes.Lookup(&pid, &txBytes)
				p.objs.TcpRxBytes.Lookup(&pid, &rxBytes)

				p.metricsChan <- ProcessMetrics{
					PID:           pid,
					IOReadBytes:   readBytes,
					IOWriteBytes:  writeBytes,
					PageCacheHits: cacheHits,
					TCPTxBytes:    txBytes,
					TCPRxBytes:    rxBytes,
				}
			}
		}
	}
}

func (p *BPFProfiler) Events() <-chan BPFEvent {
	return p.eventChan
}

func (p *BPFProfiler) Metrics() <-chan ProcessMetrics {
	return p.metricsChan
}

func (p *BPFProfiler) GetStack(stackID uint32) ([]uint64, error) {
	var stack [128]uint64
	err := p.objs.StackTraces.Lookup(stackID, &stack)
	if err != nil {
		return nil, err
	}
	
	var result []uint64
	for _, addr := range stack {
		if addr == 0 {
			break
		}
		result = append(result, addr)
	}
	return result, nil
}

func (p *BPFProfiler) Close() {
	close(p.stopChan)
	if p.ringbuf != nil {
		p.ringbuf.Close()
	}
	for _, l := range p.links {
		l.Close()
	}
	p.objs.Close()
	close(p.eventChan)
	close(p.metricsChan)
}
