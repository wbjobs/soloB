import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DataSource,
  DataSourceConfig,
  DataSourceType,
  DataSourceTable,
  DataSourceColumn,
  TypeMapping,
  FieldType,
  generateId,
  now,
} from '@lowcode/shared';

const TYPE_MAPPINGS: Record<DataSourceType, Record<string, FieldType>> = {
  postgresql: {
    'text': 'Text',
    'varchar': 'String',
    'character varying': 'String',
    'char': 'String',
    'character': 'String',
    'integer': 'Int',
    'int': 'Int',
    'int4': 'Int',
    'int8': 'Int',
    'bigint': 'Int',
    'smallint': 'Int',
    'serial': 'Int',
    'bigserial': 'Int',
    'numeric': 'Decimal',
    'decimal': 'Decimal',
    'real': 'Float',
    'float': 'Float',
    'float4': 'Float',
    'float8': 'Float',
    'double precision': 'Float',
    'boolean': 'Boolean',
    'bool': 'Boolean',
    'timestamp': 'DateTime',
    'timestamp without time zone': 'DateTime',
    'timestamp with time zone': 'DateTime',
    'date': 'DateTime',
    'time': 'DateTime',
    'json': 'Json',
    'jsonb': 'Json',
    'uuid': 'String',
  },
  mysql: {
    'text': 'Text',
    'longtext': 'Text',
    'mediumtext': 'Text',
    'tinytext': 'Text',
    'varchar': 'String',
    'char': 'String',
    'int': 'Int',
    'integer': 'Int',
    'tinyint': 'Int',
    'smallint': 'Int',
    'mediumint': 'Int',
    'bigint': 'Int',
    'decimal': 'Decimal',
    'numeric': 'Decimal',
    'float': 'Float',
    'double': 'Float',
    'boolean': 'Boolean',
    'bool': 'Boolean',
    'datetime': 'DateTime',
    'timestamp': 'DateTime',
    'date': 'DateTime',
    'time': 'DateTime',
    'json': 'Json',
    'enum': 'String',
    'set': 'String',
  },
  mongodb: {
    'string': 'String',
    'number': 'Float',
    'int': 'Int',
    'long': 'Int',
    'double': 'Float',
    'decimal': 'Decimal',
    'boolean': 'Boolean',
    'date': 'DateTime',
    'timestamp': 'DateTime',
    'object': 'Json',
    'array': 'Json',
    'binData': 'Json',
    'objectId': 'String',
  },
  rest: {
    'string': 'String',
    'number': 'Float',
    'integer': 'Int',
    'boolean': 'Boolean',
    'object': 'Json',
    'array': 'Json',
    'null': 'String',
  },
  graphql: {
    'String': 'String',
    'Int': 'Int',
    'Float': 'Float',
    'Boolean': 'Boolean',
    'ID': 'String',
    'DateTime': 'DateTime',
    'Date': 'DateTime',
    'JSON': 'Json',
  },
};

@Injectable()
export class DataSourceService {
  private readonly logger = new Logger(DataSourceService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toDataSource(db: any): DataSource {
    return {
      id: db.id,
      organizationId: db.organizationId,
      applicationId: db.applicationId,
      name: db.name,
      displayName: db.displayName,
      type: db.type as DataSourceType,
      configuration: (db.configuration || {}) as DataSourceConfig,
      status: db.status as any,
      isDefault: db.isDefault,
      createdBy: db.createdBy,
      createdAt: db.createdAt,
      updatedAt: db.updatedAt,
    };
  }

  async list(organizationId: string, applicationId?: string) {
    const where: any = { organizationId };
    if (applicationId) {
      where.OR = [
        { applicationId },
        { applicationId: null },
      ];
    }

    const dataSources = await this.prisma.dataSource.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return dataSources.map(ds => this.toDataSource(ds));
  }

  async get(id: string, organizationId: string) {
    const ds = await this.prisma.dataSource.findFirst({
      where: { id, organizationId },
    });
    if (!ds) throw new NotFoundException('Data source not found');
    return this.toDataSource(ds);
  }

  async create(organizationId: string, userId: string, data: {
    name: string;
    displayName: string;
    type: DataSourceType;
    configuration: DataSourceConfig;
    applicationId?: string;
    isDefault?: boolean;
  }) {
    const existing = await this.prisma.dataSource.findFirst({
      where: { organizationId, name: data.name },
    });
    if (existing) {
      throw new BadRequestException('Data source with this name already exists');
    }

    if (data.isDefault) {
      await this.prisma.dataSource.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const ds = await this.prisma.dataSource.create({
      data: {
        organizationId,
        applicationId: data.applicationId,
        name: data.name,
        displayName: data.displayName,
        type: data.type,
        configuration: data.configuration,
        isDefault: data.isDefault || false,
        createdBy: userId,
      },
    });

    return this.toDataSource(ds);
  }

  async update(id: string, organizationId: string, data: Partial<{
    displayName: string;
    configuration: DataSourceConfig;
    isDefault: boolean;
    status: 'active' | 'inactive' | 'error';
  }>) {
    const existing = await this.prisma.dataSource.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Data source not found');

    if (data.isDefault) {
      await this.prisma.dataSource.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const updateData: any = { updatedAt: now() };
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.configuration !== undefined) updateData.configuration = data.configuration;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;
    if (data.status !== undefined) updateData.status = data.status;

    const updated = await this.prisma.dataSource.update({
      where: { id },
      data: updateData,
    });

    return this.toDataSource(updated);
  }

  async delete(id: string, organizationId: string) {
    const existing = await this.prisma.dataSource.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Data source not found');

    await this.prisma.dataSource.delete({ where: { id } });
  }

  async testConnection(id: string, organizationId: string): Promise<{ success: boolean; error?: string }> {
    const ds = await this.get(id, organizationId);

    try {
      switch (ds.type) {
        case 'postgresql':
          return this.testPostgresConnection(ds.configuration.postgresql!);
        case 'mysql':
          return this.testMySqlConnection(ds.configuration.mysql!);
        case 'mongodb':
          return this.testMongoConnection(ds.configuration.mongodb!);
        case 'rest':
          return this.testRestConnection(ds.configuration.rest!);
        case 'graphql':
          return this.testGraphqlConnection(ds.configuration.graphql!);
        default:
          return { success: false, error: 'Unknown data source type' };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async testPostgresConnection(config: NonNullable<DataSourceConfig['postgresql']>): Promise<{ success: boolean; error?: string }> {
    try {
      const { Pool } = require('pg');
      const pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.username,
        password: config.password,
        ssl: config.ssl,
        connectionTimeoutMillis: 5000,
      });

      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      await pool.end();

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async testMySqlConnection(config: NonNullable<DataSourceConfig['mysql']>): Promise<{ success: boolean; error?: string }> {
    try {
      const mysql = require('mysql2/promise');
      const connection = await mysql.createConnection({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.username,
        password: config.password,
        ssl: config.ssl,
        connectTimeout: 5000,
      });

      await connection.execute('SELECT 1');
      await connection.end();

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async testMongoConnection(config: NonNullable<DataSourceConfig['mongodb']>): Promise<{ success: boolean; error?: string }> {
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(config.connectionString, { serverSelectionTimeoutMS: 5000 });

      await client.connect();
      await client.db(config.database).command({ ping: 1 });
      await client.close();

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async testRestConnection(config: NonNullable<DataSourceConfig['rest']>): Promise<{ success: boolean; error?: string }> {
    try {
      const axios = require('axios');
      const headers = config.headers || {};
      if (config.auth?.type === 'bearer' && config.auth.token) {
        headers['Authorization'] = `Bearer ${config.auth.token}`;
      } else if (config.auth?.type === 'api_key' && config.auth.apiKey) {
        headers[config.auth.apiKeyHeader || 'X-API-Key'] = config.auth.apiKey;
      }

      await axios.get(config.baseUrl, {
        headers,
        timeout: 5000,
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async testGraphqlConnection(config: NonNullable<DataSourceConfig['graphql']>): Promise<{ success: boolean; error?: string }> {
    try {
      const axios = require('axios');
      const headers = config.headers || {};
      if (config.auth?.type === 'bearer' && config.auth.token) {
        headers['Authorization'] = `Bearer ${config.auth.token}`;
      }

      await axios.post(
        config.endpoint,
        { query: '{ __typename }' },
        {
          headers: { 'Content-Type': 'application/json', ...headers },
          timeout: 5000,
        }
      );

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async listTables(id: string, organizationId: string): Promise<DataSourceTable[]> {
    const ds = await this.get(id, organizationId);

    switch (ds.type) {
      case 'postgresql':
        return this.listPostgresTables(ds.configuration.postgresql!);
      case 'mysql':
        return this.listMySqlTables(ds.configuration.mysql!);
      case 'mongodb':
        return this.listMongoCollections(ds.configuration.mongodb!);
      default:
        throw new BadRequestException(`Table listing not supported for ${ds.type}`);
    }
  }

  private async listPostgresTables(config: NonNullable<DataSourceConfig['postgresql']>): Promise<DataSourceTable[]> {
    const { Pool } = require('pg');
    const pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl,
    });

    try {
      const schema = config.schema || 'public';
      const result = await pool.query(`
        SELECT 
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length,
          numeric_precision
        FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, ordinal_position
      `, [schema]);

      const tables: Record<string, DataSourceTable> = {};

      for (const row of result.rows) {
        if (!tables[row.table_name]) {
          tables[row.table_name] = {
            name: row.table_name,
            schema,
            columns: [],
          };
        }

        tables[row.table_name].columns.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === 'YES',
          primaryKey: false,
          defaultValue: row.column_default,
          length: row.character_maximum_length,
          precision: row.numeric_precision,
        });
      }

      const pkResult = await pool.query(`
        SELECT 
          tc.table_name,
          kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1
      `, [schema]);

      for (const row of pkResult.rows) {
        const table = tables[row.table_name];
        if (table) {
          const col = table.columns.find(c => c.name === row.column_name);
          if (col) col.primaryKey = true;
        }
      }

      return Object.values(tables);
    } finally {
      await pool.end();
    }
  }

  private async listMySqlTables(config: NonNullable<DataSourceConfig['mysql']>): Promise<DataSourceTable[]> {
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl,
    });

    try {
      const [result] = await connection.execute(`
        SELECT 
          TABLE_NAME as table_name,
          COLUMN_NAME as column_name,
          DATA_TYPE as data_type,
          IS_NULLABLE as is_nullable,
          COLUMN_DEFAULT as column_default,
          CHARACTER_MAXIMUM_LENGTH as character_maximum_length,
          NUMERIC_PRECISION as numeric_precision,
          COLUMN_KEY as column_key
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION
      `, [config.database]);

      const tables: Record<string, DataSourceTable> = {};

      for (const row of result as any[]) {
        if (!tables[row.table_name]) {
          tables[row.table_name] = {
            name: row.table_name,
            columns: [],
          };
        }

        tables[row.table_name].columns.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === 'YES',
          primaryKey: row.column_key === 'PRI',
          defaultValue: row.column_default,
          length: row.character_maximum_length,
          precision: row.numeric_precision,
        });
      }

      return Object.values(tables);
    } finally {
      await connection.end();
    }
  }

  private async listMongoCollections(config: NonNullable<DataSourceConfig['mongodb']>): Promise<DataSourceTable[]> {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(config.connectionString);

    try {
      await client.connect();
      const db = client.db(config.database);
      const collections = await db.listCollections().toArray();

      const tables: DataSourceTable[] = [];

      for (const coll of collections) {
        const sample = await db.collection(coll.name).findOne();
        const columns: DataSourceColumn[] = [];

        if (sample) {
          for (const [key, value] of Object.entries(sample)) {
            columns.push({
              name: key,
              type: this.getMongoType(value),
              nullable: true,
              primaryKey: key === '_id',
            });
          }
        }

        tables.push({
          name: coll.name,
          columns,
        });
      }

      return tables;
    } finally {
      await client.close();
    }
  }

  private getMongoType(value: any): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Date) return 'date';
    if (typeof value === 'object') return 'object';
    return typeof value;
  }

  mapType(sourceType: DataSourceType, columnType: string): FieldType {
    const mappings = TYPE_MAPPINGS[sourceType];
    if (!mappings) return 'String';

    const lowerType = columnType.toLowerCase();
    if (mappings[columnType]) return mappings[columnType];
    if (mappings[lowerType]) return mappings[lowerType];

    for (const [pattern, mappedType] of Object.entries(mappings)) {
      if (lowerType.includes(pattern)) {
        return mappedType;
      }
    }

    return 'String';
  }

  getTypeMappings(): Record<DataSourceType, Record<string, FieldType>> {
    return TYPE_MAPPINGS;
  }
}
