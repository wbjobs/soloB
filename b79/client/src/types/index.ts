export enum DataSourceType {
  MYSQL = 'mysql',
  POSTGRESQL = 'postgresql',
  MONGODB = 'mongodb',
  REST_API = 'rest_api'
}

export interface IDataSourceConfig {
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  connectionString?: string
  url?: string
  method?: string
  headers?: Record<string, string>
  auth?: {
    type: 'basic' | 'bearer' | 'api_key'
    username?: string
    password?: string
    token?: string
    apiKey?: string
    apiKeyHeader?: string
  }
}

export interface IDataSource {
  id: string
  name: string
  type: DataSourceType
  config: IDataSourceConfig
  generatedCode: string
  npmPackageName?: string
  npmPackageVersion?: string
  createdAt: string
  updatedAt: string
}

export interface IPoolMetrics {
  poolSize: number
  avgResponseTime: number
  p95ResponseTime: number
  p99ResponseTime: number
  throughput: number
  errorRate: number
  activeConnections: number
  idleConnections: number
  queueLength: number
}

export interface IPerformancePrediction {
  recommendedPoolSize: number
  metrics: IPoolMetrics[]
  analysis: {
    bottlenecks: string[]
    recommendations: string[]
    optimalConcurrency: number
    estimatedMaxThroughput: number
  }
  testDuration: number
}
