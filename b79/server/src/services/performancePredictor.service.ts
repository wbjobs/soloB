import { DataSourceType, IDataSourceConfig } from '../models/DataSource';

export interface IPoolMetrics {
  poolSize: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  throughput: number;
  errorRate: number;
  activeConnections: number;
  idleConnections: number;
  queueLength: number;
}

export interface IPerformancePrediction {
  recommendedPoolSize: number;
  metrics: IPoolMetrics[];
  analysis: {
    bottlenecks: string[];
    recommendations: string[];
    optimalConcurrency: number;
    estimatedMaxThroughput: number;
  };
  testDuration: number;
}

class PerformancePredictorService {
  private readonly DEFAULT_TEST_DURATION = 5000;
  private readonly POOL_SIZES_TO_TEST = [5, 10, 20, 30, 50, 75, 100];

  async predictPerformance(
    type: DataSourceType,
    config: IDataSourceConfig,
    testDuration?: number
  ): Promise<IPerformancePrediction> {
    const duration = testDuration || this.DEFAULT_TEST_DURATION;
    const allMetrics: IPoolMetrics[] = [];

    for (const poolSize of this.POOL_SIZES_TO_TEST) {
      const metrics = await this.simulatePoolPerformance(type, config, poolSize, duration);
      allMetrics.push(metrics);
    }

    const analysis = this.analyzeResults(allMetrics);

    return {
      recommendedPoolSize: analysis.optimalPoolSize,
      metrics: allMetrics,
      analysis: {
        bottlenecks: analysis.bottlenecks,
        recommendations: analysis.recommendations,
        optimalConcurrency: analysis.optimalConcurrency,
        estimatedMaxThroughput: analysis.maxThroughput
      },
      testDuration: duration
    };
  }

  private async simulatePoolPerformance(
    type: DataSourceType,
    config: IDataSourceConfig,
    poolSize: number,
    duration: number
  ): Promise<IPoolMetrics> {
    const responseTimes: number[] = [];
    let totalRequests = 0;
    let errors = 0;
    let maxActiveConnections = 0;
    let maxQueueLength = 0;
    let activeConnections = 0;
    let queuedRequests = 0;

    const baseLatency = this.getBaseLatency(type, config);
    const concurrency = poolSize * 2;
    const requestInterval = duration / (concurrency * 50);
    const startTime = Date.now();

    const simulateRequest = async (): Promise<void> => {
      queuedRequests++;
      maxQueueLength = Math.max(maxQueueLength, queuedRequests);

      while (activeConnections >= poolSize) {
        await new Promise(r => setTimeout(r, 1));
      }

      queuedRequests--;
      activeConnections++;
      maxActiveConnections = Math.max(maxActiveConnections, activeConnections);

      const requestStart = Date.now();
      try {
        const latency = baseLatency * (1 + Math.random() * 0.3 - 0.15);
        await new Promise(r => setTimeout(r, latency));
        
        if (Math.random() < 0.02) {
          throw new Error('Simulated connection error');
        }
        
        responseTimes.push(Date.now() - requestStart);
        totalRequests++;
      } catch (error) {
        errors++;
        totalRequests++;
      } finally {
        activeConnections--;
      }
    };

    const workers: Promise<void>[] = [];
    const intervalId = setInterval(() => {
      for (let i = 0; i < Math.ceil(concurrency / 5); i++) {
        workers.push(simulateRequest());
      }
    }, requestInterval);

    await new Promise(r => setTimeout(r, duration));
    clearInterval(intervalId);

    await Promise.allSettled(workers);

    responseTimes.sort((a, b) => a - b);
    const avgResponseTime = responseTimes.length > 0 
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
      : 0;
    
    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);

    return {
      poolSize,
      avgResponseTime: Math.round(avgResponseTime * 100) / 100,
      p95ResponseTime: responseTimes[p95Index] || 0,
      p99ResponseTime: responseTimes[p99Index] || 0,
      throughput: Math.round((totalRequests / duration) * 1000),
      errorRate: Math.round((errors / totalRequests) * 10000) / 100,
      activeConnections: maxActiveConnections,
      idleConnections: Math.max(0, poolSize - maxActiveConnections),
      queueLength: maxQueueLength
    };
  }

  private getBaseLatency(type: DataSourceType, config: IDataSourceConfig): number {
    const baseLatencies: Record<DataSourceType, number> = {
      [DataSourceType.MYSQL]: 8,
      [DataSourceType.POSTGRESQL]: 10,
      [DataSourceType.MONGODB]: 6,
      [DataSourceType.REST_API]: 50
    };

    let latency = baseLatencies[type] || 10;

    if (config.host) {
      const isRemote = !['localhost', '127.0.0.1', ''].includes(config.host.trim());
      if (isRemote) {
        latency *= 3;
      }
    }

    return latency;
  }

  private analyzeResults(metrics: IPoolMetrics[]): {
    optimalPoolSize: number;
    bottlenecks: string[];
    recommendations: string[];
    optimalConcurrency: number;
    maxThroughput: number;
  } {
    const bottlenecks: string[] = [];
    const recommendations: string[] = [];

    let bestScore = -Infinity;
    let optimalPoolSize = 10;
    let maxThroughput = 0;
    let optimalConcurrency = 0;

    for (let i = 0; i < metrics.length; i++) {
      const m = metrics[i];
      maxThroughput = Math.max(maxThroughput, m.throughput);

      const score = 
        m.throughput * (1 - m.errorRate / 100) - 
        m.p95ResponseTime * 0.5 - 
        m.queueLength * 10;

      if (score > bestScore) {
        bestScore = score;
        optimalPoolSize = m.poolSize;
        optimalConcurrency = m.poolSize * 1.5;
      }
    }

    const optimalMetrics = metrics.find(m => m.poolSize === optimalPoolSize);

    if (optimalMetrics) {
      if (optimalMetrics.queueLength > optimalPoolSize * 0.5) {
        bottlenecks.push('请求队列过长，可能是连接池过小导致的等待堆积');
      }

      if (optimalMetrics.errorRate > 5) {
        bottlenecks.push(`错误率较高 (${optimalMetrics.errorRate}%)，可能是连接超时或资源不足`);
      }
    }

    const smallerPool = metrics.find(m => m.poolSize === optimalPoolSize / 2);
    if (smallerPool && Math.abs(smallerPool.throughput - (optimalMetrics?.throughput || 0)) < 10) {
      recommendations.push('可以考虑使用较小的连接池以节省资源，当前规模下性能差异不大');
    }

    const largerPool = metrics.find(m => m.poolSize === optimalPoolSize * 2);
    if (largerPool && Math.abs(largerPool.throughput - (optimalMetrics?.throughput || 0)) < 10) {
      recommendations.push('增大连接池不会显著提升吞吐量，瓶颈可能在数据库或网络层面');
      bottlenecks.push('数据库层面可能存在瓶颈，增加连接池大小无法线性提升性能');
    }

    if (optimalPoolSize >= 75) {
      recommendations.push('建议的连接池较大，请确保数据库服务器有足够的最大连接数配置');
    }

    if (optimalMetrics && optimalMetrics.p99ResponseTime > optimalMetrics.avgResponseTime * 3) {
      bottlenecks.push('P99响应时间远高于平均值，存在明显的长尾延迟问题');
      recommendations.push('考虑优化慢查询或增加数据库读副本以分散压力');
    }

    recommendations.unshift(`推荐的连接池大小为 ${optimalPoolSize}，此配置下可获得最佳的吞吐/延迟比`);

    if (metrics[0] && metrics[0].queueLength > 0) {
      bottlenecks.unshift('在低连接池配置下就出现了排队，说明单查询响应时间较长');
    }

    return {
      optimalPoolSize,
      bottlenecks,
      recommendations,
      optimalConcurrency: Math.round(optimalConcurrency),
      maxThroughput
    };
  }

  generatePerformanceReport(prediction: IPerformancePrediction): string {
    const lines = [
      '='.repeat(60),
      '连接池性能预测报告',
      '='.repeat(60),
      '',
      `测试时长: ${(prediction.testDuration / 1000).toFixed(1)} 秒`,
      `推荐连接池大小: ${prediction.recommendedPoolSize}`,
      `预计最优并发数: ${prediction.analysis.optimalConcurrency}`,
      `预计最大吞吐量: ${prediction.analysis.estimatedMaxThroughput} 请求/秒`,
      '',
      '- 性能指标对比 -',
      '',
      `连接池大小 | 平均响应 | P95响应 | P99响应 | 吞吐量 | 错误率 | 排队数`,
      '-'.repeat(75)
    ];

    for (const m of prediction.metrics) {
      lines.push(
        `${m.poolSize.toString().padStart(10)} | ` +
        `${m.avgResponseTime.toString().padStart(8)}ms | ` +
        `${m.p95ResponseTime.toString().padStart(7)}ms | ` +
        `${m.p99ResponseTime.toString().padStart(7)}ms | ` +
        `${m.throughput.toString().padStart(6)}/s | ` +
        `${m.errorRate.toString().padStart(5)}% | ` +
        `${m.queueLength}`
      );
    }

    lines.push('');
    lines.push('- 瓶颈分析 -');
    lines.push('');
    
    if (prediction.analysis.bottlenecks.length > 0) {
      prediction.analysis.bottlenecks.forEach((b, i) => {
        lines.push(`${i + 1}. ${b}`);
      });
    } else {
      lines.push('未检测到明显瓶颈，配置良好');
    }

    lines.push('');
    lines.push('- 优化建议 -');
    lines.push('');
    prediction.analysis.recommendations.forEach((r, i) => {
      lines.push(`${i + 1}. ${r}`);
    });

    lines.push('');
    lines.push('='.repeat(60));

    return lines.join('\n');
  }
}

export default new PerformancePredictorService();
