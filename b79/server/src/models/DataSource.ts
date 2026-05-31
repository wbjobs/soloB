import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

export enum DataSourceType {
  MYSQL = 'mysql',
  POSTGRESQL = 'postgresql',
  MONGODB = 'mongodb',
  REST_API = 'rest_api'
}

export interface IDataSourceConfig {
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  connectionString?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  auth?: {
    type: 'basic' | 'bearer' | 'api_key';
    username?: string;
    password?: string;
    token?: string;
    apiKey?: string;
    apiKeyHeader?: string;
  };
}

class DataSource extends Model {
  public id!: string;
  public name!: string;
  public type!: DataSourceType;
  public config!: IDataSourceConfig;
  public generatedCode!: string;
  public npmPackageName?: string;
  public npmPackageVersion?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DataSource.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM(...Object.values(DataSourceType)),
      allowNull: false,
    },
    config: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    generatedCode: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: 'generated_code',
    },
    npmPackageName: {
      type: DataTypes.STRING(255),
      field: 'npm_package_name',
    },
    npmPackageVersion: {
      type: DataTypes.STRING(50),
      field: 'npm_package_version',
    },
  },
  {
    sequelize,
    modelName: 'DataSource',
    tableName: 'data_sources',
    timestamps: true,
  }
);

export default DataSource;
