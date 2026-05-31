import Docker from 'dockerode';
import { v4 as uuidv4 } from 'uuid';
import { DataSourceType, IDataSourceConfig } from '../models/DataSource';
import codeGeneratorService from './codeGenerator.service';

const CONTAINER_TIMEOUT = 10 * 60 * 1000;
const TEST_CONTAINER_TIMEOUT = 60 * 1000;
const IMAGE_CLEANUP_INTERVAL = 30 * 60 * 1000;

class DockerService {
  private docker: Docker;
  private containers: Map<string, NodeJS.Timeout> = new Map();
  private testImages: Set<string> = new Set();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.docker = new Docker({
      socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock'
    });
    this.setupCleanupHandlers();
  }

  private setupCleanupHandlers(): void {
    const cleanup = async () => {
      console.log('Performing Docker cleanup...');
      await this.stopAllContainers();
      await this.cleanupTestImages();
      process.exit(0);
    };

    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);

    this.cleanupInterval = setInterval(async () => {
      await this.cleanupOrphanedContainers();
    }, IMAGE_CLEANUP_INTERVAL);
  }

  private getImageForType(type: DataSourceType): string {
    const images: Record<DataSourceType, string> = {
      [DataSourceType.MYSQL]: 'mysql:8.0',
      [DataSourceType.POSTGRESQL]: 'postgres:16',
      [DataSourceType.MONGODB]: 'mongo:7',
      [DataSourceType.REST_API]: 'node:20-alpine'
    };
    return images[type];
  }

  private getContainerConfig(type: DataSourceType, id: string): Docker.ContainerCreateOptions {
    const baseConfig: Docker.ContainerCreateOptions = {
      name: `test-${type}-${id}`,
      HostConfig: {
        AutoRemove: true
      },
      NetworkingConfig: {
        EndpointsConfig: {}
      }
    };

    switch (type) {
      case DataSourceType.MYSQL:
        return {
          ...baseConfig,
          Env: [
            'MYSQL_ROOT_PASSWORD=test123',
            'MYSQL_DATABASE=testdb',
            'MYSQL_USER=testuser',
            'MYSQL_PASSWORD=testpass'
          ],
          Healthcheck: {
            Test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost'],
            Interval: 2000000000,
            Timeout: 1000000000,
            Retries: 5
          }
        };
      case DataSourceType.POSTGRESQL:
        return {
          ...baseConfig,
          Env: [
            'POSTGRES_DB=testdb',
            'POSTGRES_USER=testuser',
            'POSTGRES_PASSWORD=testpass'
          ],
          Healthcheck: {
            Test: ['CMD', 'pg_isready', '-U', 'testuser', '-d', 'testdb'],
            Interval: 2000000000,
            Timeout: 1000000000,
            Retries: 5
          }
        };
      case DataSourceType.MONGODB:
        return {
          ...baseConfig,
          Healthcheck: {
            Test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"],
            Interval: 2000000000,
            Timeout: 1000000000,
            Retries: 5
          }
        };
      default:
        return baseConfig;
    }
  }

  async createTestContainer(type: DataSourceType): Promise<{ containerId: string; host: string; port: number }> {
    const id = uuidv4().substring(0, 8);
    const image = this.getImageForType(type);
    const config = this.getContainerConfig(type, id);

    try {
      await this.docker.getImage(image).inspect();
    } catch {
      await this.docker.pull(image);
    }

    const container = await this.docker.createContainer(config);
    await container.start();

    const containerInfo = await container.inspect();
    const networkSettings = containerInfo.NetworkSettings;
    let port = 0;

    switch (type) {
      case DataSourceType.MYSQL:
        port = 3306;
        break;
      case DataSourceType.POSTGRESQL:
        port = 5432;
        break;
      case DataSourceType.MONGODB:
        port = 27017;
        break;
    }

    const timeout = setTimeout(async () => {
      console.log(`Container ${container.id} timed out, cleaning up...`);
      await this.stopContainer(container.id);
    }, CONTAINER_TIMEOUT);

    this.containers.set(container.id, timeout);

    return {
      containerId: container.id,
      host: networkSettings.IPAddress || 'localhost',
      port
    };
  }

  async stopContainer(containerId: string): Promise<void> {
    try {
      const timeout = this.containers.get(containerId);
      if (timeout) {
        clearTimeout(timeout);
        this.containers.delete(containerId);
      }
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 10 });
      await container.remove({ force: true });
    } catch (error) {
      console.error('Error stopping container:', error);
    }
  }

  async stopAllContainers(): Promise<void> {
    console.log(`Stopping ${this.containers.size} managed containers...`);
    const containerIds = Array.from(this.containers.keys());
    for (const containerId of containerIds) {
      await this.stopContainer(containerId);
    }
  }

  async cleanupTestImages(): Promise<void> {
    console.log(`Cleaning up ${this.testImages.size} test images...`);
    const images = Array.from(this.testImages);
    for (const imageName of images) {
      try {
        const image = this.docker.getImage(imageName);
        await image.remove({ force: true });
        this.testImages.delete(imageName);
      } catch (error) {
        console.error(`Error removing image ${imageName}:`, error);
      }
    }
  }

  async cleanupOrphanedContainers(): Promise<void> {
    try {
      const containers = await this.docker.listContainers({ all: true });
      const testContainers = containers.filter((c) =>
        c.Names.some((n) => n.startsWith('/test-') || n.includes('test-connector'))
      );
      
      console.log(`Found ${testContainers.length} orphaned test containers`);
      
      for (const container of testContainers) {
        try {
          const c = this.docker.getContainer(container.Id);
          const info = await c.inspect();
          const runningTime = Date.now() - new Date(info.Created).getTime();
          
          if (runningTime > CONTAINER_TIMEOUT) {
            await c.stop({ t: 10 });
            await c.remove({ force: true });
            console.log(`Cleaned up orphaned container: ${container.Id}`);
          }
        } catch (error) {
          console.error('Error cleaning up container:', error);
        }
      }
    } catch (error) {
      console.error('Error listing containers:', error);
    }
  }

  async waitForContainerReady(containerId: string, maxRetries: number = 30): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const container = this.docker.getContainer(containerId);
        const info = await container.inspect();
        if (info.State.Health && info.State.Health.Status === 'healthy') {
          return;
        }
        if (info.State.Running && !info.State.Health) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return;
        }
      } catch (error) {
        console.error('Error checking container health:', error);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Container did not become ready in time');
  }

  async testConnectionInContainer(
    type: DataSourceType,
    config: IDataSourceConfig,
    name: string
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const testCode = codeGeneratorService.generateCode(type, config, name);
    const packageJson = codeGeneratorService.generatePackageJson(name, '1.0.0', type);

    const testScript = `
${testCode}

const Connector = require('./index.js');

async function runTest() {
  try {
    const connector = new Connector({});
    const result = await connector.testConnection();
    console.log(JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.log(JSON.stringify({ success: false, error: error.message }));
    process.exit(1);
  }
}

runTest();
`;

    const dockerfile = `
FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY index.js .
COPY test.js .
CMD ["node", "test.js"]
`;

    const tar = require('tar-stream');
    const pack = tar.pack();

    pack.entry({ name: 'package.json' }, packageJson);
    pack.entry({ name: 'index.js' }, testCode);
    pack.entry({ name: 'test.js' }, testScript);
    pack.entry({ name: 'Dockerfile' }, dockerfile);
    pack.finalize();

    const buildImageName = `test-connector-${uuidv4().substring(0, 8)}`;
    let container: Docker.Container | null = null;
    let timeoutId: NodeJS.Timeout | null = null;

    try {
      await this.docker.buildImage(pack, { t: buildImageName });
      this.testImages.add(buildImageName);

      container = await this.docker.createContainer({
        Image: buildImageName,
        HostConfig: {
          AutoRemove: true
        }
      });

      await container.start();

      timeoutId = setTimeout(async () => {
        console.log(`Test container ${container!.id} timed out, stopping...`);
        try {
          await container!.stop({ t: 10 });
        } catch (e) {
          console.error('Error stopping timed out container:', e);
        }
      }, TEST_CONTAINER_TIMEOUT);

      const result = await container.wait();
      
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      const logs = await container.logs({ stdout: true, stderr: true });
      const output = logs.toString();

      setTimeout(async () => {
        try {
          const image = this.docker.getImage(buildImageName);
          await image.remove({ force: true });
          this.testImages.delete(buildImageName);
        } catch (e) {
          console.error('Error cleaning up test image:', e);
        }
      }, 5000);

      try {
        const jsonMatch = output.match(/\{.*\}/s);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch {
      }

      return {
        success: result.StatusCode === 0,
        message: result.StatusCode === 0 ? 'Connection test successful' : 'Connection test failed',
        error: output
      };
    } catch (error: any) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      setTimeout(async () => {
        try {
          const image = this.docker.getImage(buildImageName);
          await image.remove({ force: true });
          this.testImages.delete(buildImageName);
        } catch (e) {
        }
      }, 5000);

      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default new DockerService();
