package ebpf

import (
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/perf"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/cilium/ebpf/rlimit"
	"go.uber.org/zap"
)

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -cflags "-O2 -g -Wall -D__TARGET_ARCH_x86" bpfCompat profiler_compat.bpf.c

// ProbeMode represents the active probing mode
type ProbeMode string

const (
	ProbeModeKprobe     ProbeMode = "kprobe"
	ProbeModeTracepoint ProbeMode = "tracepoint"
	ProbeModeAuto       ProbeMode = "auto"
)

// ProfilerConfig contains dynamic configuration for the profiler
type ProfilerConfig struct {
	Mode            ProbeMode
	EnableKprobes   bool
	EnableTracepoints bool
	EnableStack     bool
	EnableMetrics   bool
	TargetPID       uint32
	Verbose         bool
}

// ProfilerEvent represents a parsed event from BPF
type ProfilerEvent struct {
	Timestamp   uint64
	PID         uint32
	TGID        uint32
	Comm        string
	EventType   uint32
	DurationNs  uint64
	Bytes       uint64
	Address     uint64
	Retval      int32
	KernelVersion uint32
	ProbeType   uint32
}

// ProcessMetricsSnapshot is a snapshot of per-process metrics
type ProcessMetricsSnapshot struct {
	PID             uint32
	IOReadBytes     uint64
	IOWriteBytes    uint64
	IOReadCount     uint64
	IOWriteCount    uint64
	PageCacheHits   uint64
	TCPTxBytes      uint64
	TCPRxBytes      uint64
	MemAllocBytes   uint64
	LockWaitTimeNs  uint64
	LockCount       uint64
}

// CompatProfiler is the main profiler with kernel compatibility support
type CompatProfiler struct {
	objs         bpfCompatObjects
	config       ProfilerConfig
	features     *KernelFeatures
	links        []link.Link
	ringbuf      *ringbuf.Reader
	eventChan    chan ProfilerEvent
	metricsChan  chan ProcessMetricsSnapshot
	stopChan     chan struct{}
	metricsDone  chan struct{}
	logger       *zap.Logger
	isRunning    bool
	mutex        sync.Mutex
}

// NewCompatProfiler creates a new profiler with automatic kernel compatibility
func NewCompatProfiler(config ProfilerConfig) (*CompatProfiler, error) {
	// Remove memory limit first
	if err := rlimit.RemoveMemlock(); err != nil {
		return nil, fmt.Errorf("rlimit: %w", err)
	}

	// Detect kernel features
	features, err := DetectKernelFeatures()
	if err != nil {
		return nil, fmt.Errorf("feature detection: %w", err)
	}

	// Auto-select mode if needed
	if config.Mode == ProbeModeAuto {
		if features.KprobeSupport && features.HasBTF {
			config.Mode = ProbeModeKprobe
			config.EnableKprobes = true
			config.EnableTracepoints = false
		} else if features.TracepointSupport {
			config.Mode = ProbeModeTracepoint
			config.EnableKprobes = false
			config.EnableTracepoints = true
		} else {
			return nil, fmt.Errorf("no supported probe modes available")
		}
	}

	logger, _ := zap.NewProduction()

	profiler := &CompatProfiler{
		config:      config,
		features:    features,
		eventChan:   make(chan ProfilerEvent, 1024),
		metricsChan: make(chan ProcessMetricsSnapshot, 256),
		stopChan:    make(chan struct{}),
		metricsDone: make(chan struct{}),
		logger:      logger,
	}

	// Load BPF programs
	if err := profiler.loadBPF(); err != nil {
		return nil, err
	}

	// Populate kernel config map for BPF-side decisions
	if err := profiler.populateConfigMap(); err != nil {
		profiler.Close()
		return nil, fmt.Errorf("config map: %w", err)
	}

	// Attach probes based on mode
	if err := profiler.attachProbes(); err != nil {
		profiler.Close()
		return nil, fmt.Errorf("attach probes: %w", err)
	}

	// Setup ring buffer
	if err := profiler.setupRingbuf(); err != nil {
		profiler.Close()
		return nil, fmt.Errorf("ringbuf: %w", err)
	}

	// Start background metrics collection
	go profiler.collectMetrics()

	return profiler, nil
}

func (p *CompatProfiler) loadBPF() error {
	var opts *ebpf.CollectionOptions

	// Use CO-RE relocations if BTF available
	if p.features.HasBTF {
		opts = &ebpf.CollectionOptions{
			Programs: ebpf.ProgramOptions{
				LogLevel: ebpf.LogLevelBranch,
			},
		}
	} else {
		// No BTF available - use simpler loading without CO-RE
		opts = &ebpf.CollectionOptions{
			Programs: ebpf.ProgramOptions{
				LogLevel: ebpf.LogLevelBranch,
			},
		}
	}

	spec, err := loadBpfCompat()
	if err != nil {
		return fmt.Errorf("load spec: %w", err)
	}

	// Conditionally rewrite constants for older kernels
	if p.features.Version.Less(Kernel5_4) {
		p.logger.Info("Applying kernel < 5.4 compatibility tweaks")
		// On older kernels, some helpers may not be available
		// We'll handle this in BPF via runtime checks
	}

	if err := spec.LoadAndAssign(&p.objs, opts); err != nil {
		return fmt.Errorf("load objects: %w", err)
	}

	return nil
}

func (p *CompatProfiler) populateConfigMap() error {
	// Kernel config map key is always 0
	key := uint32(0)

	// Build feature flags for BPF side
	featureFlags := uint32(0)
	if p.features.Features&FeatureBPFStack != 0 {
		featureFlags |= 1 << 1 // FEAT_BPF_STACK
	}
	if p.features.Features&FeatureBPFSpinLock != 0 {
		featureFlags |= 1 << 2 // FEAT_BPF_SPIN_LOCK
	}

	useTracepoint := uint32(0)
	if p.config.Mode == ProbeModeTracepoint {
		useTracepoint = 1
	}

	// Match struct kernel_config from kernel_compat.h
	type BPFConfig struct {
		KernelVersion uint32
		FeatureFlags  uint32
		UseTracepoint uint32
		CompatLevel   uint32
	}

	config := BPFConfig{
		KernelVersion: encodeVersion(p.features.Version),
		FeatureFlags:  featureFlags,
		UseTracepoint: useTracepoint,
		CompatLevel:   p.getCompatLevel(),
	}

	p.logger.Info("Populating BPF config map",
		zap.Uint32("kernel_version", config.KernelVersion),
		zap.Uint32("feature_flags", config.FeatureFlags),
		zap.Uint32("use_tracepoint", config.UseTracepoint),
		zap.String("mode", string(p.config.Mode)))

	return p.objs.KernelConfigMap.Update(key, &config, ebpf.UpdateAny)
}

func encodeVersion(v KernelVersion) uint32 {
	// Match Linux KERNEL_VERSION macro: (major<<16) | (minor<<8) | patch
	return uint32(v.Major)<<16 | uint32(v.Minor)<<8 | uint32(v.Patch)
}

func (p *CompatProfiler) getCompatLevel() uint32 {
	switch {
	case p.features.Version.AtLeast(Kernel5_10):
		return 3
	case p.features.Version.AtLeast(Kernel5_4):
		return 2
	case p.features.Version.AtLeast(Kernel4_18):
		return 1
	default:
		return 0
	}
}

func (p *CompatProfiler) attachProbes() error {
	var errs []error

	if p.config.EnableKprobes && p.config.Mode == ProbeModeKprobe {
		p.logger.Info("Attaching kprobes")

		// vfs_read - file IO
		if l, err := link.Kprobe("vfs_read", p.objs.KprobeVfsRead, nil); err == nil {
			p.links = append(p.links, l)
		} else {
			errs = append(errs, fmt.Errorf("vfs_read kprobe: %w", err))
		}

		if l, err := link.Kretprobe("vfs_read", p.objs.KretprobeVfsRead, nil); err == nil {
			p.links = append(p.links, l)
		} else {
			errs = append(errs, fmt.Errorf("vfs_read kretprobe: %w", err))
		}

		// vfs_write - file IO
		if l, err := link.Kprobe("vfs_write", p.objs.KprobeVfsWrite, nil); err == nil {
			p.links = append(p.links, l)
		} else {
			errs = append(errs, fmt.Errorf("vfs_write kprobe: %w", err))
		}

		if l, err := link.Kretprobe("vfs_write", p.objs.KretprobeVfsWrite, nil); err == nil {
			p.links = append(p.links, l)
		} else {
			errs = append(errs, fmt.Errorf("vfs_write kretprobe: %w", err))
		}

		p.logger.Info("kprobes attached successfully", zap.Int("count", len(p.links)))
	}

	if p.config.EnableTracepoints && p.config.Mode == ProbeModeTracepoint {
		p.logger.Info("Attaching tracepoints (fallback mode)")

		// sys_enter_read - tracepoint fallback
		if l, err := link.Tracepoint("syscalls", "sys_enter_read", p.objs.TracepointEnterRead, nil); err == nil {
			p.links = append(p.links, l)
		} else {
			errs = append(errs, fmt.Errorf("sys_enter_read tracepoint: %w", err))
		}

		if l, err := link.Tracepoint("syscalls", "sys_exit_read", p.objs.TracepointExitRead, nil); err == nil {
			p.links = append(p.links, l)
		} else {
			errs = append(errs, fmt.Errorf("sys_exit_read tracepoint: %w", err))
		}

		// sys_enter_write
		if l, err := link.Tracepoint("syscalls", "sys_enter_write", p.objs.TracepointEnterWrite, nil); err == nil {
			p.links = append(p.links, l)
		} else {
			errs = append(errs, fmt.Errorf("sys_enter_write tracepoint: %w", err))
		}

		if l, err := link.Tracepoint("syscalls", "sys_exit_write", p.objs.TracepointExitWrite, nil); err == nil {
			p.links = append(p.links, l)
		} else {
			errs = append(errs, fmt.Errorf("sys_exit_write tracepoint: %w", err))
		}

		// kmem tracepoints for allocation tracking
		if l, err := link.Tracepoint("kmem", "kmalloc", p.objs.TracepointKmalloc, nil); err == nil {
			p.links = append(p.links, l)
		} else {
			p.logger.Debug("kmem/kmalloc tracepoint not available", zap.Error(err))
		}

		// tcp sendmsg tracepoint
		if l, err := link.Tracepoint("tcp", "tcp_sendmsg", p.objs.TracepointTcpSendmsg, nil); err == nil {
			p.links = append(p.links, l)
		} else {
			p.logger.Debug("tcp/tcp_sendmsg tracepoint not available", zap.Error(err))
		}

		p.logger.Info("Tracepoints attached", zap.Int("count", len(p.links)))
	}

	// We need at least some probes to work
	if len(p.links) == 0 && len(errs) > 0 {
		return fmt.Errorf("no probes attached: %v", errs)
	}

	if len(errs) > 0 {
		p.logger.Warn("Some probes failed to attach, continuing with available",
			zap.Errors("failures", errs))
	}

	return nil
}

func (p *CompatProfiler) setupRingbuf() error {
	var err error
	p.ringbuf, err = ringbuf.NewReader(p.objs.Events)
	if err != nil {
		return fmt.Errorf("ringbuf reader: %w", err)
	}

	// Start event polling
	go p.pollEvents()

	return nil
}

func (p *CompatProfiler) pollEvents() {
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
				p.logger.Debug("Ringbuf read error", zap.Error(err))
				continue
			}

			event, err := p.parseEvent(record.RawSample)
			if err != nil {
				p.logger.Debug("Event parse error", zap.Error(err))
				continue
			}

			// Filter by PID if configured
			if p.config.TargetPID > 0 && event.PID != p.config.TargetPID {
				continue
			}

			select {
			case p.eventChan <- event:
			default:
				// Channel full, drop
			}
		}
	}
}

func (p *CompatProfiler) parseEvent(data []byte) (ProfilerEvent, error) {
	if len(data) < 48 { // Minimum expected size
		return ProfilerEvent{}, fmt.Errorf("event too small: %d bytes", len(data))
	}

	// Match struct profiler_event layout
	type rawEvent struct {
		Timestamp   uint64
		PID         uint32
		TGID        uint32
		Comm        [16]byte
		EventType   uint32
		DurationNs  uint64
		Bytes       uint64
		Address     uint64
		Retval      int32
		Filename    [256]byte
		StackID     uint64
		KernelVers  uint32
		ProbeType   uint32
	}

	var raw rawEvent
	if err := binary.Read(strings.NewReader(string(data)), binary.LittleEndian, &raw); err != nil {
		return ProfilerEvent{}, err
	}

	// Convert comm to string
	comm := ""
	for i, b := range raw.Comm {
		if b == 0 {
			comm = string(raw.Comm[:i])
			break
		}
	}
	if comm == "" {
		comm = string(raw.Comm[:])
	}

	return ProfilerEvent{
		Timestamp:   raw.Timestamp,
		PID:         raw.PID,
		TGID:        raw.TGID,
		Comm:        comm,
		EventType:   raw.EventType,
		DurationNs:  raw.DurationNs,
		Bytes:       raw.Bytes,
		Address:     raw.Address,
		Retval:      raw.Retval,
		KernelVersion: raw.KernelVers,
		ProbeType:   raw.ProbeType,
	}, nil
}

func (p *CompatProfiler) collectMetrics() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-p.stopChan:
			close(p.metricsDone)
			return
		case <-ticker.C:
			if !p.config.EnableMetrics {
				continue
			}

			// Read from process metrics map
			var key uint32
			var value struct {
				IOReadBytes    uint64
				IOWriteBytes   uint64
				IOReadCount    uint64
				IOWriteCount   uint64
				PageCacheHits  uint64
				TCPTxBytes     uint64
				TCPRxBytes     uint64
				MemAllocBytes  uint64
				LockWaitTimeNs uint64
				LockCount      uint64
			}

			iter := p.objs.ProcessMetricsMap.Iterate()
			for iter.Next(&key, &value) {
				if p.config.TargetPID > 0 && key != p.config.TargetPID {
					continue
				}

				snapshot := ProcessMetricsSnapshot{
					PID:             key,
					IOReadBytes:     value.IOReadBytes,
					IOWriteBytes:    value.IOWriteBytes,
					IOReadCount:     value.IOReadCount,
					IOWriteCount:    value.IOWriteCount,
					PageCacheHits:   value.PageCacheHits,
					TCPTxBytes:      value.TCPTxBytes,
					TCPRxBytes:      value.TCPRxBytes,
					MemAllocBytes:   value.MemAllocBytes,
					LockWaitTimeNs:  value.LockWaitTimeNs,
					LockCount:       value.LockCount,
				}

				select {
				case p.metricsChan <- snapshot:
				default:
				}
			}
		}
	}
}

// Events returns the channel of profiler events
func (p *CompatProfiler) Events() <-chan ProfilerEvent {
	return p.eventChan
}

// Metrics returns the channel of process metrics snapshots
func (p *CompatProfiler) Metrics() <-chan ProcessMetricsSnapshot {
	return p.metricsChan
}

// GetMode returns the active probe mode
func (p *CompatProfiler) GetMode() ProbeMode {
	return p.config.Mode
}

// GetFeatures returns detected kernel features
func (p *CompatProfiler) GetFeatures() *KernelFeatures {
	return p.features
}

// Close cleans up all resources
func (p *CompatProfiler) Close() {
	p.mutex.Lock()
	defer p.mutex.Unlock()

	if !p.isRunning {
		return
	}

	close(p.stopChan)

	// Wait for metrics collection to stop
	<-p.metricsDone

	if p.ringbuf != nil {
		p.ringbuf.Close()
	}

	for _, l := range p.links {
		l.Close()
	}
	p.links = nil

	p.objs.Close()

	close(p.eventChan)
	close(p.metricsChan)

	p.isRunning = false
}

// PrintCompatibilityInfo outputs kernel compatibility information
func PrintCompatibilityInfo() error {
	report, err := GenerateCompatibilityReport()
	if err != nil {
		return err
	}
	report.PrintReport()
	return nil
}
