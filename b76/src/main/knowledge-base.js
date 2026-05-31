class KnowledgeBase {
  constructor() {
    this.solutions = this.initSolutions();
  }

  initSolutions() {
    return [
      {
        id: 'TIMEOUT_OIC_RES',
        patterns: ['/oic/res', '超时', 'timeout'],
        title: '资源发现接口超时',
        severity: 'high',
        description: '设备的资源发现接口无响应，可能是设备未正确实现 OCF 核心规范',
        causes: [
          '设备 CoAP 服务器未正确启动',
          '网络防火墙阻止了 5683/udp 端口',
          '设备休眠导致无法响应',
          '设备实现不符合 OCF 1.0+ 规范'
        ],
        solutions: [
          '检查设备是否在线并处于工作状态',
          '确认设备防火墙允许 5683/udp 端口通信',
          '尝试重启设备后重新测试',
          '检查设备固件版本是否支持 OCF 标准',
          '使用 Wireshark 捕获 CoAP 数据包进行分析'
        ],
        references: ['OCF Core Specification v1.0 - Section 8.2.1', 'CoAP RFC 7252']
      },
      {
        id: 'TIMEOUT_OIC_D',
        patterns: ['/oic/d', '超时', 'timeout'],
        title: '设备信息接口超时',
        severity: 'medium',
        description: '设备信息查询接口无响应',
        causes: [
          '设备资源模型实现不完整',
          '设备资源路径配置错误',
          '网络延迟过高'
        ],
        solutions: [
          '验证设备是否正确声明 /oic/d 资源',
          '检查网络连接质量',
          '增加请求超时时间后重试',
          '使用 OCF 资源浏览器验证资源可访问性'
        ],
        references: ['OCF Core Specification v1.0 - Section 8.2.2']
      },
      {
        id: 'TIMEOUT_OIC_P',
        patterns: ['/oic/p', '超时', 'timeout'],
        title: '平台信息接口超时',
        severity: 'medium',
        description: '平台信息查询接口无响应',
        causes: [
          '设备平台资源未实现',
          '设备处于受限运行模式'
        ],
        solutions: [
          '检查设备是否支持平台信息查询',
          '查看设备技术文档确认支持的资源列表',
          '联系设备厂商获取技术支持'
        ],
        references: ['OCF Core Specification v1.0 - Section 8.2.3']
      },
      {
        id: 'CONNECTION_REFUSED',
        patterns: ['连接被拒绝', 'ECONNREFUSED', 'connection refused'],
        title: '连接被拒绝',
        severity: 'critical',
        description: '设备拒绝了连接请求',
        causes: [
          '设备 CoAP 服务未运行',
          '端口号配置错误',
          '设备安全策略阻止了连接',
          'IP 地址变更导致设备不可达'
        ],
        solutions: [
          '确认设备 IP 地址和端口号是否正确',
          '检查设备 CoAP 服务是否正常运行',
          '验证设备访问控制列表配置',
          '重新执行设备发现获取最新设备信息'
        ],
        references: ['CoAP RFC 7252 - Section 4.5']
      },
      {
        id: 'NETWORK_UNREACHABLE',
        patterns: ['网络不可达', 'ENETUNREACH', 'network unreachable'],
        title: '网络不可达',
        severity: 'critical',
        description: '无法到达目标网络',
        causes: [
          '设备与测试主机不在同一子网',
          '路由器配置问题',
          '设备已离线',
          'VLAN 隔离导致无法访问'
        ],
        solutions: [
          '确认测试主机与设备在同一网络',
          '检查路由器和交换机配置',
          '验证设备电源和网络连接状态',
          '检查 VLAN 和子网划分配置'
        ],
        references: []
      },
      {
        id: 'HTTP_404',
        patterns: ['4.04', '404', 'Not Found'],
        title: '资源不存在',
        severity: 'high',
        description: '请求的资源在设备上不存在',
        causes: [
          '设备未实现该资源',
          '资源路径拼写错误',
          '设备固件版本不支持该资源'
        ],
        solutions: [
          '使用 /oic/res 查看设备支持的资源列表',
          '确认资源路径是否正确',
          '升级设备固件到最新版本',
          '参考设备厂商文档确认支持的资源'
        ],
        references: ['OCF Core Specification v1.0 - Section 6']
      },
      {
        id: 'HTTP_401',
        patterns: ['4.01', '401', 'Unauthorized'],
        title: '未授权访问',
        severity: 'high',
        description: '访问被拒绝，需要认证',
        causes: [
          '设备启用了访问控制',
          '测试工具未提供有效认证凭证',
          '访问令牌已过期'
        ],
        solutions: [
          '配置设备进入可配对模式',
          '执行设备归属流程后重试',
          '检查访问控制列表 (ACL) 配置',
          '验证认证令牌有效性'
        ],
        references: ['OCF Security Specification v1.0']
      },
      {
        id: 'HTTP_500',
        patterns: ['5.00', '500', 'Internal Server Error'],
        title: '服务器内部错误',
        severity: 'high',
        description: '设备处理请求时发生内部错误',
        causes: [
          '设备固件 bug',
          '资源处理逻辑异常',
          '设备内存不足'
        ],
        solutions: [
          '重启设备后重试',
          '升级设备固件',
          '减少同时请求的数量',
          '联系厂商报告 bug'
        ],
        references: []
      },
      {
        id: 'SEC_DOXM',
        patterns: ['/oic/sec/doxm', 'sec', 'security'],
        title: '安全配置接口访问失败',
        severity: 'medium',
        description: '设备所有者转让方法接口访问异常',
        causes: [
          '设备已被其他所有者拥有',
          '安全模式限制了访问',
          '需要先完成设备配对'
        ],
        solutions: [
          '检查设备当前所有者状态',
          '将设备重置为未归属状态',
          '完成设备配对流程后重试',
          '参考 OCF 安全规范进行正确配置'
        ],
        references: ['OCF Security Specification v1.0 - Section 6']
      },
      {
        id: 'SEC_PSTAT',
        patterns: ['/oic/sec/pstat', 'pstat', 'provisioning'],
        title: '配置状态接口访问失败',
        severity: 'medium',
        description: '设备配置状态接口访问异常',
        causes: [
          '设备未完成初始配置',
          '配置状态不一致',
          '需要管理员权限'
        ],
        solutions: [
          '执行设备初始配置流程',
          '检查设备配置状态是否正常',
          '使用管理员权限访问',
          '重置设备到出厂设置'
        ],
        references: ['OCF Security Specification v1.0 - Section 5']
      },
      {
        id: 'GENERAL_TIMEOUT',
        patterns: ['超时', 'timeout', 'ETIMEDOUT'],
        title: '请求超时',
        severity: 'medium',
        description: '请求在规定时间内未收到响应',
        causes: [
          '网络延迟过高',
          '设备负载过重响应慢',
          '数据包丢失'
        ],
        solutions: [
          '增加请求超时时间',
          '检查网络带宽和延迟',
          '减少测试并发数',
          '确认设备 CPU 和内存使用率'
        ],
        references: ['CoAP RFC 7252 - Section 4.2']
      },
      {
        id: 'MULTIPLE_FAILURES',
        patterns: ['multiple', '多个', '全部'],
        title: '多个测试用例失败',
        severity: 'critical',
        description: '多个或全部测试用例执行失败',
        causes: [
          '设备离线或网络断开',
          '设备固件存在严重问题',
          '设备不兼容 OCF 标准',
          '跨厂商互操作性问题'
        ],
        solutions: [
          '首先检查设备是否在线且可访问',
          '验证基本网络连通性 (ping)',
          '使用 OCF 认证工具重新认证设备',
          '联系厂商获取技术支持',
          '检查是否为已知的互操作性问题'
        ],
        references: ['OCF Certification Test Cases']
      }
    ];
  }

  matchSolutions(result) {
    const matchedSolutions = [];
    const searchText = `${result.resource_path || ''} ${result.error_message || ''} ${result.http_code || ''}`.toLowerCase();

    for (const solution of this.solutions) {
      const matchCount = solution.patterns.filter(
        pattern => searchText.includes(pattern.toLowerCase())
      ).length;

      if (matchCount > 0) {
        matchedSolutions.push({
          ...solution,
          matchScore: matchCount,
          matchedPatterns: solution.patterns.filter(
            pattern => searchText.includes(pattern.toLowerCase())
          )
        });
      }
    }

    return matchedSolutions.sort((a, b) => b.matchScore - a.matchScore);
  }

  analyzeTestResults(results) {
    const failedResults = results.filter(r => r.status === 'fail');
    const analysis = {
      totalTests: results.length,
      failedTests: failedResults.length,
      passedTests: results.filter(r => r.status === 'pass').length,
      overallStatus: failedResults.length === 0 ? 'pass' : (failedResults.length > results.length / 2 ? 'critical' : 'warning'),
      recommendations: [],
      commonIssues: {}
    };

    const allSolutions = [];
    const issueCategories = new Set();

    failedResults.forEach(result => {
      const solutions = this.matchSolutions(result);
      if (solutions.length > 0) {
        allSolutions.push({
          resource: result.resource_path,
          errorMessage: result.error_message,
          solutions: solutions.slice(0, 3)
        });
        solutions.forEach(s => issueCategories.add(s.severity));
      }
    });

    analysis.recommendations = allSolutions;
    analysis.issueSeverities = Array.from(issueCategories);

    if (failedResults.length >= results.length * 0.8) {
      const multipleFailuresSolution = this.solutions.find(s => s.id === 'MULTIPLE_FAILURES');
      if (multipleFailuresSolution) {
        analysis.overallRecommendation = multipleFailuresSolution;
      }
    }

    return analysis;
  }

  getSolutionById(id) {
    return this.solutions.find(s => s.id === id);
  }

  getAllSolutions() {
    return this.solutions;
  }

  getSolutionsBySeverity(severity) {
    return this.solutions.filter(s => s.severity === severity);
  }
}

module.exports = KnowledgeBase;