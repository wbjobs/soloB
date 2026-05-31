import { DataSourceType, IDataSourceConfig } from '../models/DataSource';

export class CodeGeneratorService {
  public generateCode(type: DataSourceType, config: IDataSourceConfig, name: string): string {
    switch (type) {
      case DataSourceType.MYSQL:
        return this.generateMySQLCode(config, name);
      case DataSourceType.POSTGRESQL:
        return this.generatePostgreSQLCode(config, name);
      case DataSourceType.MONGODB:
        return this.generateMongoDBCode(config, name);
      case DataSourceType.REST_API:
        return this.generateRestAPICode(config, name);
      default:
        throw new Error(`Unsupported data source type: ${type}`);
    }
  }

  private generateMySQLCode(config: IDataSourceConfig, name: string): string {
    return `/**
 * MySQL Connector for ${name}
 * Dependencies: npm install mysql2@^3.6.5
 */
const mysql = require('mysql2/promise');

class ${this.toPascalCase(name)}MySQLConnector {
  constructor(options) {
    this.config = {
      host: options.host || '${config.host || 'localhost'}',
      port: options.port || ${config.port || 3306},
      database: options.database || '${config.database || ''}',
      user: options.username || '${config.username || ''}',
      password: options.password || '${config.password || ''}',
      connectionLimit: options.connectionLimit || 10,
      ...options
    };
    this.pool = null;
  }

  async connect() {
    try {
      this.pool = mysql.createPool(this.config);
      const connection = await this.pool.getConnection();
      connection.release();
      return { success: true, message: 'Connected to MySQL successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async query(sql, params = []) {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }
    const [rows, fields] = await this.pool.execute(sql, params);
    return { rows, fields };
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  async testConnection() {
    try {
      const result = await this.connect();
      if (result.success) {
        await this.close();
      }
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ${this.toPascalCase(name)}MySQLConnector;
`;
  }

  private generatePostgreSQLCode(config: IDataSourceConfig, name: string): string {
    return `/**
 * PostgreSQL Connector for ${name}
 * Dependencies: npm install pg@^8.11.3
 */
const { Client, Pool } = require('pg');

class ${this.toPascalCase(name)}PostgreSQLConnector {
  constructor(options) {
    this.config = {
      host: options.host || '${config.host || 'localhost'}',
      port: options.port || ${config.port || 5432},
      database: options.database || '${config.database || ''}',
      user: options.username || '${config.username || ''}',
      password: options.password || '${config.password || ''}',
      max: options.max || 10,
      ...options
    };
    this.pool = null;
  }

  async connect() {
    try {
      this.pool = new Pool(this.config);
      const client = await this.pool.connect();
      client.release();
      return { success: true, message: 'Connected to PostgreSQL successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async query(text, params = []) {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }
    const result = await this.pool.query(text, params);
    return { rows: result.rows, fields: result.fields };
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  async testConnection() {
    try {
      const result = await this.connect();
      if (result.success) {
        await this.close();
      }
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ${this.toPascalCase(name)}PostgreSQLConnector;
`;
  }

  private generateMongoDBCode(config: IDataSourceConfig, name: string): string {
    const connectionString = config.connectionString 
      ? config.connectionString 
      : `mongodb://${config.username}:${config.password}@${config.host}:${config.port}/${config.database}`;

    return `/**
 * MongoDB Connector for ${name}
 * Dependencies: npm install mongodb@^6.3.0
 */
const { MongoClient } = require('mongodb');

class ${this.toPascalCase(name)}MongoDBConnector {
  constructor(options) {
    this.connectionString = options.connectionString || '${connectionString}';
    this.dbName = options.database || '${config.database || 'test'}';
    this.client = null;
    this.db = null;
  }

  async connect() {
    try {
      this.client = new MongoClient(this.connectionString);
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      await this.db.command({ ping: 1 });
      return { success: true, message: 'Connected to MongoDB successfully' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async find(collection, query = {}, options = {}) {
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    const cursor = this.db.collection(collection).find(query, options);
    return await cursor.toArray();
  }

  async insertOne(collection, document) {
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    return await this.db.collection(collection).insertOne(document);
  }

  async insertMany(collection, documents) {
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    return await this.db.collection(collection).insertMany(documents);
  }

  async updateOne(collection, filter, update, options = {}) {
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    return await this.db.collection(collection).updateOne(filter, update, options);
  }

  async deleteOne(collection, filter) {
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    return await this.db.collection(collection).deleteOne(filter);
  }

  async close() {
    if (this.client) {
      await this.client.close();
    }
  }

  async testConnection() {
    try {
      const result = await this.connect();
      if (result.success) {
        await this.close();
      }
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ${this.toPascalCase(name)}MongoDBConnector;
`;
  }

  private generateRestAPICode(config: IDataSourceConfig, name: string): string {
    const headers = config.headers ? JSON.stringify(config.headers, null, 2) : '{}';
    const authConfig = this.generateAuthConfig(config);

    return `/**
 * REST API Connector for ${name}
 * Dependencies: npm install axios@^1.6.2
 */
const axios = require('axios');

class ${this.toPascalCase(name)}RestAPIConnector {
  constructor(options) {
    this.baseURL = options.baseURL || '${config.url || ''}';
    this.headers = options.headers || ${headers};
    this.auth = options.auth || ${authConfig};
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: this.headers,
      timeout: options.timeout || 30000
    });
    this.setupAuth();
  }

  setupAuth() {
    if (!this.auth) return;

    switch (this.auth.type) {
      case 'basic':
        this.client.defaults.auth = {
          username: this.auth.username,
          password: this.auth.password
        };
        break;
      case 'bearer':
        this.client.defaults.headers.common['Authorization'] = \`Bearer \${this.auth.token}\`;
        break;
      case 'api_key':
        this.client.defaults.headers.common[this.auth.apiKeyHeader || 'X-API-Key'] = this.auth.apiKey;
        break;
    }
  }

  async get(path, params = {}) {
    const response = await this.client.get(path, { params });
    return response.data;
  }

  async post(path, data = {}, config = {}) {
    const response = await this.client.post(path, data, config);
    return response.data;
  }

  async put(path, data = {}, config = {}) {
    const response = await this.client.put(path, data, config);
    return response.data;
  }

  async patch(path, data = {}, config = {}) {
    const response = await this.client.patch(path, data, config);
    return response.data;
  }

  async delete(path, config = {}) {
    const response = await this.client.delete(path, config);
    return response.data;
  }

  async request(config) {
    const response = await this.client.request(config);
    return response.data;
  }

  async testConnection() {
    try {
      const testPath = this.baseURL ? '' : '/';
      await this.client.get(testPath, { validateStatus: () => true });
      return { success: true, message: 'REST API connection test successful' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ${this.toPascalCase(name)}RestAPIConnector;
`;
  }

  private generateAuthConfig(config: IDataSourceConfig): string {
    if (!config.auth) {
      return 'null';
    }
    return JSON.stringify(config.auth, null, 2).split('\n').map((line, i) => i > 0 ? '    ' + line : line).join('\n');
  }

  private toPascalCase(str: string): string {
    return str.replace(/(^|_)([a-z])/g, (_match, _p1, p2) => p2.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
  }

  public generatePackageJson(name: string, version: string, type: DataSourceType): string {
    const dependencies: Record<string, string> = {
      [DataSourceType.MYSQL]: { 'mysql2': '^3.6.5' },
      [DataSourceType.POSTGRESQL]: { 'pg': '^8.11.3' },
      [DataSourceType.MONGODB]: { 'mongodb': '^6.3.0' },
      [DataSourceType.REST_API]: { 'axios': '^1.6.2' },
    }[type] || {};

    return JSON.stringify({
      name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      version,
      description: `Data source connector for ${name}`,
      main: 'index.js',
      keywords: ['datasource', 'connector', type],
      author: 'Lowcode Platform',
      license: 'MIT',
      dependencies
    }, null, 2);
  }
}

export default new CodeGeneratorService();
