package security

import (
	"regexp"
	"strings"
)

type DangerousPattern struct {
	Pattern string
	Level   string
	Message string
}

var dangerousPatterns = []DangerousPattern{
	{
		Pattern: `rm\s+.*-rf?.*[/*]`,
		Level:   "critical",
		Message: "检测到危险的删除命令，已阻断",
	},
	{
		Pattern: `rm\s+-rf?\s+/`,
		Level:   "critical",
		Message: "检测到根目录删除命令，已阻断",
	},
	{
		Pattern: `chmod\s+.*777`,
		Level:   "high",
		Message: "检测到777权限修改，已阻断",
	},
	{
		Pattern: `chmod\s+-R\s+777`,
		Level:   "critical",
		Message: "检测到递归777权限修改，已阻断",
	},
	{
		Pattern: `dd\s+.*if=/dev/(zero|urandom).*of=/dev/(sd|hd)`,
		Level:   "critical",
		Message: "检测到磁盘覆盖命令，已阻断",
	},
	{
		Pattern: `mkfs\s+`,
		Level:   "high",
		Message: "检测到格式化命令，已阻断",
	},
	{
		Pattern: `shutdown\s+`,
		Level:   "high",
		Message: "检测到关机命令，已阻断",
	},
	{
		Pattern: `reboot\s*`,
		Level:   "high",
		Message: "检测到重启命令，已阻断",
	},
	{
		Pattern: `:\(\){\s*:\|:\s*&}\s*;:\s*`,
		Level:   "critical",
		Message: "检测到Fork炸弹，已阻断",
	},
	{
		Pattern: `wget\s+.*\|.*sh`,
		Level:   "high",
		Message: "检测到远程脚本执行，已阻断",
	},
	{
		Pattern: `curl\s+.*\|.*sh`,
		Level:   "high",
		Message: "检测到远程脚本执行，已阻断",
	},
	{
		Pattern: `>\s*/etc/passwd`,
		Level:   "critical",
		Message: "检测到修改系统用户文件，已阻断",
	},
	{
		Pattern: `>\s*/etc/shadow`,
		Level:   "critical",
		Message: "检测到修改系统密码文件，已阻断",
	},
}

type CheckResult struct {
	IsDangerous bool
	Blocked     bool
	Level       string
	Message     string
}

func CheckCommand(command string) CheckResult {
	cmd := strings.TrimSpace(command)
	cmdLower := strings.ToLower(cmd)

	for _, dp := range dangerousPatterns {
		matched, _ := regexp.MatchString(dp.Pattern, cmdLower)
		if matched {
			return CheckResult{
				IsDangerous: true,
				Blocked:     true,
				Level:       dp.Level,
				Message:     dp.Message,
			}
		}
	}

	return CheckResult{
		IsDangerous: false,
		Blocked:     false,
	}
}
