export type DataSourceType = 'postgresql' | 'mysql' | 'mongodb' | 'rest' | 'graphql';

export interface DataSourceConfig {
  postgresql?: {
    host: string;
    port: number;
    database: string;
    username: string;
    password?: string;
    ssl?: boolean;
    schema?: string;
  };
  mysql?: {
    host: string;
    port: number;
    database: string;
    username: string;
    password?: string;
    ssl?: boolean;
  };
  mongodb?: {
    connectionString: string;
    database: string;
  };
  rest?: {
    baseUrl: string;
    headers?: Record<string, string>;
    auth?: {
      type: 'basic' | 'bearer' | 'api_key';
      token?: string;
      username?: string;
      password?: string;
      apiKey?: string;
      apiKeyHeader?: string;
    };
  };
  graphql?: {
    endpoint: string;
    headers?: Record<string, string>;
    auth?: {
      type: 'bearer' | 'api_key';
      token?: string;
    };
  };
}

export interface DataSource {
  id: string;
  organizationId: string;
  applicationId?: string;
  name: string;
  displayName: string;
  type: DataSourceType;
  configuration: DataSourceConfig;
  status: 'active' | 'inactive' | 'error';
  isDefault: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TypeMapping {
  source: DataSourceType;
  sourceType: string;
  targetType: string;
  nullable: boolean;
  defaultValue?: any;
}

export interface DataSourceTable {
  name: string;
  schema?: string;
  columns: DataSourceColumn[];
}

export interface DataSourceColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: any;
  length?: number;
  precision?: number;
}
