package ebpf

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/btf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/rlimit"
)

// KernelVersion represents a parsed kernel version
type KernelVersion struct {
	Major int
	Minor int
	Patch int
	Full  string
}

func (v KernelVersion) String() string {
	return fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch)
}

// Compare returns -1 if v < other, 0 if equal, 1 if v > other
func (v KernelVersion) Compare(other KernelVersion) int {
	if v.Major != other.Major {
		return v.Major - other.Major
	}
	if v.Minor != other.Minor {
		return v.Minor - other.Minor
	}
	return v.Patch - other.Patch
}

// Less returns true if v < other
func (v KernelVersion) Less(other KernelVersion) bool {
	return v.Compare(other) < 0
}

// Greater returns true if v > other
func (v KernelVersion) Greater(other KernelVersion) bool {
	return v.Compare(other) > 0
}

// AtLeast returns true if v >= other
func (v KernelVersion) AtLeast(other KernelVersion) bool {
	return v.Compare(other) >= 0
}

// Known kernel version constants
var (
	Kernel4_15 = KernelVersion{4, 15, 0, ""}
	Kernel4_18 = KernelVersion{4, 18, 0, ""}
	Kernel5_4  = KernelVersion{5, 4, 0, ""}
	Kernel5_8  = KernelVersion{5, 8, 0, ""}
	Kernel5_10 = KernelVersion{5, 10, 0, ""}
	Kernel5_15 = KernelVersion{5, 15, 0, ""}
)

// Feature flags matching kernel_compat.h
const (
	FeatureKprobeMulti  = 1 << 0
	FeatureBPFStack     = 1 << 1
	FeatureBPFSpinLock  = 1 << 2
	FeatureTracepoint   = 1 << 3
	FeatureCOREReloc    = 1 << 4
	FeatureRingBuf      = 1 << 5
)

// KernelFeatures contains detected kernel eBPF capabilities
type KernelFeatures struct {
	Version       KernelVersion
	Features      uint32
	HasBTF        bool
	BTFSpec       string
	KprobeSupport bool
	TracepointSupport bool
	CORESupport   bool
	KallsymsAvail bool
}

// CompatibilityReport summarizes kernel compatibility
type CompatibilityReport struct {
	KernelVersion   KernelVersion
	Features        KernelFeatures
	RecommendedMode string // "kprobe" or "tracepoint" or "none"
	Warnings        []string
	Errors          []string
	DegradedFeatures []string
	IsFullSupport   bool
}

var (
	cachedVersion   *KernelVersion
	cachedFeatures  *KernelFeatures
	cacheMutex      sync.Mutex
)

// GetKernelVersion detects and parses the running kernel version
func GetKernelVersion() (KernelVersion, error) {
	cacheMutex.Lock()
	defer cacheMutex.Unlock()

	if cachedVersion != nil {
		return *cachedVersion, nil
	}

	// Method 1: uname syscall
	var uts syscall.Utsname
	if err := syscall.Uname(&uts); err == nil {
		release := bytesToString(uts.Release[:])
		version, err := parseKernelVersion(release)
		if err == nil {
			cachedVersion = &version
			return version, nil
		}
	}

	// Method 2: /proc/version_signature
	if data, err := os.ReadFile("/proc/version_signature"); err == nil {
		if version, err := parseUbuntuVersionSignature(string(data)); err == nil {
			cachedVersion = &version
			return version, nil
		}
	}

	// Method 3: /proc/sys/kernel/osrelease
	if data, err := os.ReadFile("/proc/sys/kernel/osrelease"); err == nil {
		if version, err := parseKernelVersion(strings.TrimSpace(string(data))); err == nil {
			cachedVersion = &version
			return version, nil
		}
	}

	return KernelVersion{}, fmt.Errorf("failed to detect kernel version")
}

func bytesToString(b []int8) string {
	buf := make([]byte, 0, len(b))
	for _, c := range b {
		if c == 0 {
			break
		}
		buf = append(buf, byte(c))
	}
	return string(buf)
}

func parseKernelVersion(release string) (KernelVersion, error) {
	parts := strings.SplitN(release, ".", 3)
	if len(parts) < 2 {
		return KernelVersion{}, fmt.Errorf("invalid version format: %s", release)
	}

	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return KernelVersion{}, fmt.Errorf("invalid major: %w", err)
	}

	minor, err := strconv.Atoi(parts[1])
	if err != nil {
		return KernelVersion{}, fmt.Errorf("invalid minor: %w", err)
	}

	patch := 0
	if len(parts) >= 3 {
		patchStr := strings.SplitN(parts[2], "-", 2)[0]
		patch, _ = strconv.Atoi(patchStr)
	}

	return KernelVersion{
		Major: major,
		Minor: minor,
		Patch: patch,
		Full:  release,
	}, nil
}

func parseUbuntuVersionSignature(sig string) (KernelVersion, error) {
	parts := strings.Fields(sig)
	if len(parts) < 3 {
		return KernelVersion{}, fmt.Errorf("invalid version signature: %s", sig)
	}
	return parseKernelVersion(parts[2])
}

// DetectKernelFeatures probes the kernel for eBPF capabilities
func DetectKernelFeatures() (*KernelFeatures, error) {
	cacheMutex.Lock()
	defer cacheMutex.Unlock()

	if cachedFeatures != nil {
		return cachedFeatures, nil
	}

	version, err := GetKernelVersion()
	if err != nil {
		return nil, err
	}

	features := &KernelFeatures{
		Version:  version,
		Features: 0,
	}

	// Base features by version
	if version.AtLeast(Kernel4_15) {
		features.Features |= FeatureTracepoint
		features.TracepointSupport = true
	}

	if version.AtLeast(Kernel4_18) {
		features.Features |= FeatureCOREReloc
		features.CORESupport = true
	}

	if version.AtLeast(Kernel5_4) {
		features.Features |= FeatureBPFStack
		features.Features |= FeatureBPFSpinLock
		features.Features |= FeatureRingBuf
		features.KprobeSupport = true
	}

	if version.AtLeast(Kernel5_8) {
		features.Features |= FeatureKprobeMulti
	}

	// Check BTF availability
	features.HasBTF = checkBTFAvailability()
	if features.HasBTF {
		features.BTFSpec = detectBTFSpec()
	}

	// Check /proc/kallsyms availability
	features.KallsymsAvail = checkKallsymsAvailable()

	// Probe actual kprobe support
	if version.AtLeast(Kernel4_15) {
		features.KprobeSupport = probeKprobeSupport()
	}

	// Probe actual tracepoint support
	features.TracepointSupport = probeTracepointSupport()

	cachedFeatures = features
	return features, nil
}

func checkBTFAvailability() bool {
	// Check standard BTF locations
	paths := []string{
		"/sys/kernel/btf/vmlinux",
		"/sys/kernel/debug/btf/vmlinux",
		"/boot/vmlinux-4.15.0-213-generic.btf", // Ubuntu-style
	}

	for _, path := range paths {
		if _, err := os.Stat(path); err == nil {
			return true
		}
	}

	// Try loading via btf package
	_, err := btf.LoadKernelSpec()
	return err == nil
}

func detectBTFSpec() string {
	// Try to detect BTF variant
	if _, err := os.Stat("/sys/kernel/btf/vmlinux"); err == nil {
		return "sysfs"
	}
	if _, err := os.Stat("/sys/kernel/debug/btf/vmlinux"); err == nil {
		return "debugfs"
	}
	return "none"
}

func checkKallsymsAvailable() bool {
	_, err := os.Open("/proc/kallsyms")
	return err == nil
}

func probeKprobeSupport() bool {
	// Try creating a simple kprobe to verify support
	if err := rlimit.RemoveMemlock(); err != nil {
		return false
	}

	// We'll use a minimal probe test
	// This is a simple test using a basic BPF program structure
	spec := &ebpf.ProgramSpec{
		Type:    ebpf.Kprobe,
		License: "Dual BSD/GPL",
		Instructions: getTestBPFCode(),
	}

	prog, err := ebpf.NewProgramWithOptions(spec, ebpf.ProgramOptions{
		LogLevel: 0,
	})
	if err != nil {
		return false
	}
	defer prog.Close()

	return true
}

func probeTracepointSupport() bool {
	if err := rlimit.RemoveMemlock(); err != nil {
		return false
	}

	// Check if tracepoint events directory exists
	if _, err := os.Stat("/sys/kernel/debug/tracing/events"); err != nil {
		if _, err2 := os.Stat("/sys/kernel/tracing/events"); err2 != nil {
			return false
		}
	}

	return true
}

// getTestBPFCode returns minimal BPF bytecode for testing
func getTestBPFCode() []byte {
	// Minimal BPF program: r0 = 0; exit;
	return []byte{
		0xb7, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // mov r0, 0
		0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // exit
	}
}

// GenerateCompatibilityReport creates a comprehensive compatibility report
func GenerateCompatibilityReport() (*CompatibilityReport, error) {
	features, err := DetectKernelFeatures()
	if err != nil {
		return nil, err
	}

	report := &CompatibilityReport{
		KernelVersion:      features.Version,
		Features:           *features,
		Warnings:           []string{},
		Errors:             []string{},
		DegradedFeatures:   []string{},
	}

	// Determine recommended mode
	switch {
	case features.KprobeSupport && features.HasBTF:
		report.RecommendedMode = "kprobe"
		report.IsFullSupport = true
	case features.TracepointSupport:
		report.RecommendedMode = "tracepoint"
		report.IsFullSupport = false
		report.Warnings = append(report.Warnings, 
			"Falling back to tracepoint mode - reduced precision and feature set")
		report.DegradedFeatures = append(report.DegradedFeatures,
			"IO latency measurement (tracepoint timing less precise)",
			"Stack trace collection (not available in tracepoint mode)",
			"TCP payload inspection (limited in tracepoint mode)")
	default:
		report.RecommendedMode = "none"
		report.IsFullSupport = false
		report.Errors = append(report.Errors,
			"No supported probe modes available. Requires kernel 4.15+")
	}

	// Version-specific warnings
	if features.Version.Less(Kernel5_4) {
		report.Warnings = append(report.Warnings,
			"Kernel < 5.4: Some advanced eBPF features not available")
		report.DegradedFeatures = append(report.DegradedFeatures,
			"BPF_STACK_TRACE not available",
			"BPF_SPIN_LOCK not available")
	}

	if !features.HasBTF {
		report.Warnings = append(report.Warnings,
			"BTF (BPF Type Format) not available - CO-RE relocations disabled")
		report.DegradedFeatures = append(report.DegradedFeatures,
			"CO-RE type safe access to kernel structs")
	}

	// Check required kernel configs
	checkKernelConfig(report)

	return report, nil
}

func checkKernelConfig(report *CompatibilityReport) {
	// Common locations for kernel config
	configPaths := []string{
		"/proc/config.gz",
		"/boot/config-" + report.KernelVersion.Full,
		"/lib/modules/" + report.KernelVersion.Full + "/config",
	}

	for _, path := range configPaths {
		if _, err := os.Stat(path); err == nil {
			checkConfigOptions(path, report)
			return
		}
	}

	report.Warnings = append(report.Warnings,
		"Cannot verify kernel config - kernel config file not found")
}

func checkConfigOptions(path string, report *CompatibilityReport) {
	required := map[string]string{
		"CONFIG_BPF":               "BPF support",
		"CONFIG_BPF_SYSCALL":       "BPF syscall interface",
		"CONFIG_KPROBE_EVENTS":     "Kprobe events",
		"CONFIG_UPROBE_EVENTS":     "Uprobe events",
		"CONFIG_TRACEPOINTS":       "Tracepoint support",
		"CONFIG_BPF_JIT":           "BPF JIT compiler",
	}

	var file *os.File
	var err error
	
	if strings.HasSuffix(path, ".gz") {
		// Skip gzip for now in this simplified implementation
		return
	}
	
	file, err = os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	found := make(map[string]bool)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		for opt := range required {
			if strings.HasPrefix(line, opt+"=y") || strings.HasPrefix(line, opt+"=m") {
				found[opt] = true
			}
		}
	}

	for opt, desc := range required {
		if !found[opt] {
			report.Warnings = append(report.Warnings,
				fmt.Sprintf("Kernel config %s (%s) may be disabled", opt, desc))
		}
	}
}

// GetFeatureNames returns human-readable names for enabled features
func (f *KernelFeatures) GetFeatureNames() []string {
	names := []string{}
	if f.Features&FeatureKprobeMulti != 0 {
		names = append(names, "kprobe-multi")
	}
	if f.Features&FeatureBPFStack != 0 {
		names = append(names, "bpf-stack")
	}
	if f.Features&FeatureBPFSpinLock != 0 {
		names = append(names, "bpf-spinlock")
	}
	if f.Features&FeatureTracepoint != 0 {
		names = append(names, "tracepoint")
	}
	if f.Features&FeatureCOREReloc != 0 {
		names = append(names, "core-reloc")
	}
	if f.Features&FeatureRingBuf != 0 {
		names = append(names, "ringbuf")
	}
	return names
}

// PrintReport outputs a formatted compatibility report
func (r *CompatibilityReport) PrintReport() {
	fmt.Println("\n" + strings.Repeat("=", 60))
	fmt.Println("          eBPF Kernel Compatibility Report")
	fmt.Println(strings.Repeat("=", 60))
	
	fmt.Printf("\nKernel Version: %s\n", r.KernelVersion.String())
	fmt.Printf("Recommended Mode: %s\n", r.RecommendedMode)
	fmt.Printf("Full Support: %v\n", r.IsFullSupport)

	fmt.Println("\nDetected Features:")
	for _, name := range r.Features.GetFeatureNames() {
		fmt.Printf("  ✅ %s\n", name)
	}

	if r.Features.HasBTF {
		fmt.Printf("  ✅ BTF available (%s)\n", r.Features.BTFSpec)
	} else {
		fmt.Println("  ❌ BTF not available")
	}

	if len(r.Warnings) > 0 {
		fmt.Println("\nWarnings:")
		for _, w := range r.Warnings {
			fmt.Printf("  ⚠️  %s\n", w)
		}
	}

	if len(r.Errors) > 0 {
		fmt.Println("\nErrors:")
		for _, e := range r.Errors {
			fmt.Printf("  ❌ %s\n", e)
		}
	}

	if len(r.DegradedFeatures) > 0 {
		fmt.Println("\nDegraded Features:")
		for _, f := range r.DegradedFeatures {
			fmt.Printf("  ➖ %s\n", f)
		}
	}

	if r.IsFullSupport {
		fmt.Println("\n✅ Full eBPF feature support available!")
	} else if r.RecommendedMode != "none" {
		fmt.Println("\n⚠️  Running in compatibility mode - some features degraded")
	} else {
		fmt.Println("\n❌ No supported eBPF modes available")
	}

	fmt.Println(strings.Repeat("=", 60))
}
