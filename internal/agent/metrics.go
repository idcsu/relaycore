package agent

import (
	"os"
	"strconv"
	"strings"
	"syscall"

	"relaycore/internal/common"
)

func CollectMetrics(ruleCount int) common.NodeMetrics {
	m := common.NodeMetrics{}
	m.Load1 = readLoad()
	m.MemoryTotal, m.MemoryUsed = readMem()
	m.DiskTotal, m.DiskUsed = readDisk("/")
	m.NetIn, m.NetOut = readNet()
	m.Uptime = readUptime()
	m.ConntrackCount = readUintFile("/proc/sys/net/netfilter/nf_conntrack_count")
	m.ConntrackMax = readUintFile("/proc/sys/net/netfilter/nf_conntrack_max")
	m.TCPRetransSegments, m.TCPOutSegments = readTCPSegments()
	m.ForwardingRuleCount = ruleCount
	return m
}

func readLoad() float64 {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(b))
	if len(fields) == 0 {
		return 0
	}
	v, _ := strconv.ParseFloat(fields[0], 64)
	return v
}

func readMem() (total, used uint64) {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	var free, buffers, cached uint64
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		v, _ := strconv.ParseUint(fields[1], 10, 64)
		v *= 1024
		switch strings.TrimSuffix(fields[0], ":") {
		case "MemTotal":
			total = v
		case "MemFree":
			free = v
		case "Buffers":
			buffers = v
		case "Cached":
			cached = v
		}
	}
	if total > free+buffers+cached {
		used = total - free - buffers - cached
	}
	return total, used
}

func readDisk(path string) (total, used uint64) {
	var st syscall.Statfs_t
	if syscall.Statfs(path, &st) != nil {
		return 0, 0
	}
	total = st.Blocks * uint64(st.Bsize)
	free := st.Bavail * uint64(st.Bsize)
	if total > free {
		used = total - free
	}
	return total, used
}

func readNet() (in, out uint64) {
	b, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return 0, 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		name := strings.TrimSpace(parts[0])
		if name == "lo" {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) < 16 {
			continue
		}
		rx, _ := strconv.ParseUint(fields[0], 10, 64)
		tx, _ := strconv.ParseUint(fields[8], 10, 64)
		in += rx
		out += tx
	}
	return in, out
}

func readUptime() uint64 {
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(b))
	if len(fields) == 0 {
		return 0
	}
	f, _ := strconv.ParseFloat(fields[0], 64)
	return uint64(f)
}

func readUintFile(path string) uint64 {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	v, _ := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
	return v
}

func readTCPSegments() (retrans, out uint64) {
	b, err := os.ReadFile("/proc/net/snmp")
	if err != nil {
		return 0, 0
	}
	lines := strings.Split(string(b), "\n")
	for i := 0; i+1 < len(lines); i++ {
		if !strings.HasPrefix(lines[i], "Tcp:") || !strings.HasPrefix(lines[i+1], "Tcp:") {
			continue
		}
		headers := strings.Fields(lines[i])
		values := strings.Fields(lines[i+1])
		for j, h := range headers {
			if j >= len(values) {
				continue
			}
			v, _ := strconv.ParseUint(values[j], 10, 64)
			switch h {
			case "RetransSegs":
				retrans = v
			case "OutSegs":
				out = v
			}
		}
	}
	return retrans, out
}
