export const prismaSchemaTemplate = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

{{{explicitJoinTables}}}

{{#each models}}
model {{pascalCase @root.name}} {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
{{#each @root.fields}}
  {{camelCase name}} {{prismaType type}}{{#if required}}{{else}}?{{/if}}{{#if unique}} @unique{{/if}}
{{/each}}
{{#each @root.relations}}
  {{relationField this @root.name}}
{{/each}}
{{#if @root.indexes}}
{{#each @root.indexes}}
  @@index([{{fieldNames this}}]{{#if unique}}, unique{{/if}})
{{/each}}
{{/if}}
}

{{/each}}
`;

export const entityTemplate = `
export interface {{pascalCase model.name}}Base {
  id: string;
  createdAt: Date;
  updatedAt: Date;
{{#each model.fields}}
  {{camelCase name}}: {{tsType type}}{{#if required}}{{else}} | null{{/if}};
{{/each}}
}

export interface {{pascalCase model.name}} extends {{pascalCase model.name}}Base {
{{#each model.relations}}
  {{relationEntityField this @root.model.name}}
{{/each}}
}

export type {{pascalCase model.name}}WithRelations = {{pascalCase model.name}};

export interface {{pascalCase model.name}}CreateInput {
{{#each model.fields}}
  {{camelCase name}}{{#if required}}{{else}}?{{/if}}: {{tsType type}}{{#if required}}{{else}} | null{{/if}};
{{/each}}
{{#each model.oneToOneRelations}}
  {{camelCase name}}Id?: string | null;
{{/each}}
}

export type {{pascalCase model.name}}UpdateInput = Partial<{{pascalCase model.name}}CreateInput>;
`;

export const nestControllerTemplate = `
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { {{pascalCase model.name}}Service } from './{{camelCase model.name}}.service';
import { {{pascalCase model.name}}, {{pascalCase model.name}}CreateInput, {{pascalCase model.name}}UpdateInput } from './entities/{{camelCase model.name}}.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('{{pluralize camelCase model.name}}')
@Controller('api/{{pluralize camelCase model.name}}')
@UseGuards(JwtAuthGuard, RolesGuard)
export class {{pascalCase model.name}}Controller {
  constructor(private readonly {{camelCase model.name}}Service: {{pascalCase model.name}}Service) {}

  @Get()
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Get all {{pluralize model.name}}' })
  @ApiResponse({ status: 200, type: [{{pascalCase model.name}}] })
  async findAll(@Query() query: any): Promise<{{pascalCase model.name}}[]> {
    return this.{{camelCase model.name}}Service.findAll(query);
  }

  @Get(':id')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Get {{model.name}} by id' })
  @ApiResponse({ status: 200, type: {{pascalCase model.name}} })
  async findOne(@Param('id') id: string): Promise<{{pascalCase model.name}} | null> {
    return this.{{camelCase model.name}}Service.findOne(id);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create {{model.name}}' })
  @ApiResponse({ status: 201, type: {{pascalCase model.name}} })
  async create(@Body() data: {{pascalCase model.name}}CreateInput): Promise<{{pascalCase model.name}}> {
    return this.{{camelCase model.name}}Service.create(data);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update {{model.name}}' })
  @ApiResponse({ status: 200, type: {{pascalCase model.name}} })
  async update(@Param('id') id: string, @Body() data: {{pascalCase model.name}}UpdateInput): Promise<{{pascalCase model.name}}> {
    return this.{{camelCase model.name}}Service.update(id, data);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete {{model.name}}' })
  @ApiResponse({ status: 200 })
  async remove(@Param('id') id: string): Promise<void> {
    return this.{{camelCase model.name}}Service.remove(id);
  }
}
`;

export const nestServiceTemplate = `
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { {{pascalCase model.name}}, {{pascalCase model.name}}CreateInput, {{pascalCase model.name}}UpdateInput } from './entities/{{camelCase model.name}}.entity';

@Injectable()
export class {{pascalCase model.name}}Service {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: any): Promise<{{pascalCase model.name}}[]> {
    return this.prisma.{{camelCase model.name}}.findMany(query);
  }

  async findOne(id: string): Promise<{{pascalCase model.name}} | null> {
    return this.prisma.{{camelCase model.name}}.findUnique({ where: { id } });
  }

  async create(data: {{pascalCase model.name}}CreateInput): Promise<{{pascalCase model.name}}> {
    return this.prisma.{{camelCase model.name}}.create({ data });
  }

  async update(id: string, data: {{pascalCase model.name}}UpdateInput): Promise<{{pascalCase model.name}}> {
    const exists = await this.prisma.{{camelCase model.name}}.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('{{model.name}} not found');
    }
    return this.prisma.{{camelCase model.name}}.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.{{camelCase model.name}}.delete({ where: { id } });
  }
}
`;

export const nestModuleTemplate = `
import { Module } from '@nestjs/common';
import { {{pascalCase model.name}}Controller } from './{{camelCase model.name}}.controller';
import { {{pascalCase model.name}}Service } from './{{camelCase model.name}}.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [{{pascalCase model.name}}Controller],
  providers: [{{pascalCase model.name}}Service],
  exports: [{{pascalCase model.name}}Service],
})
export class {{pascalCase model.name}}Module {}
`;

export const nextPageTemplate = `
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { {{componentImports}} } from 'antd';
import { {{componentImports}} } from '@ant-design/icons';
import apiService from '../../services/api';

interface {{pascalCase page.name}}PageProps {}

export default function {{pascalCase page.name}}Page({}: {{pascalCase page.name}}PageProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
{{#each page.stateVariables}}
  const [{{camelCase @key}}, set{{pascalCase @key}}] = useState({{{json @value}}});
{{/each}}

  useEffect(() => {
{{#if hasOnLoad}}
    handleLoad();
{{/if}}
  }, []);

{{#each page.onLoadHandlers}}
  const handle{{pascalCase @index}}Load = async () => {
    {{{actionCode @this}}}
  };
{{/each}}

  const handleLoad = async () => {
    setLoading(true);
    try {
{{#each page.onLoadHandlers}}
      await handle{{pascalCase @index}}Load();
{{/each}}
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

{{#each page.eventHandlers}}
  const handle{{pascalCase @index}} = async () => {
    {{{actionCode @this}}}
  };
{{/each}}

  return (
    <div style={{ minHeight: '100vh', padding: '24px' }}>
      {{{renderComponents page.components}}}
    </div>
  );
}
`;

export const nestAppModuleTemplate = `
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { WorkflowModule } from './workflow/workflow.module';
{{#each modules}}
import { {{pascalCase this}}Module } from './{{camelCase this}}/{{camelCase this}}.module';
{{/each}}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 10,
    }),
    PrismaModule,
    AuthModule,
    WorkflowModule,
{{#each modules}}
    {{pascalCase this}}Module,
{{/each}}
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
`;

export const nestMainTemplate = `
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  const config = new DocumentBuilder()
    .setTitle('{{appName}} API')
    .setDescription('{{appName}} API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(\`Application is running on: \${await app.getUrl()}\`);
  logger.log(\`Swagger documentation: \${await app.getUrl()}/docs\`);
}

bootstrap();
`;

export const nextPackageJsonTemplate = `
{
  "name": "{{appName}}-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.0.0",
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "antd": "5.12.0",
    "@ant-design/icons": "5.2.6",
    "axios": "1.6.0",
    "mobx": "6.10.0",
    "mobx-react-lite": "4.0.0"
  },
  "devDependencies": {
    "@types/node": "20.10.0",
    "@types/react": "18.2.0",
    "@types/react-dom": "18.2.0",
    "typescript": "5.3.0",
    "eslint": "8.55.0",
    "eslint-config-next": "14.0.0"
  }
}
`;

export const nestPackageJsonTemplate = `
{
  "name": "{{appName}}-backend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "start:prod": "node dist/main",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "10.2.0",
    "@nestjs/core": "10.2.0",
    "@nestjs/config": "3.1.0",
    "@nestjs/jwt": "10.2.0",
    "@nestjs/passport": "10.0.0",
    "@nestjs/swagger": "7.1.0",
    "@nestjs/throttler": "5.0.0",
    "@prisma/client": "5.6.0",
    "bcrypt": "5.1.0",
    "class-transformer": "0.5.0",
    "class-validator": "0.14.0",
    "passport": "0.7.0",
    "passport-jwt": "4.0.0",
    "reflect-metadata": "0.1.13",
    "rxjs": "7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "10.2.0",
    "@nestjs/schematics": "10.0.0",
    "@types/bcrypt": "5.0.0",
    "@types/node": "20.10.0",
    "@types/passport-jwt": "3.0.0",
    "prisma": "5.6.0",
    "typescript": "5.3.0"
  }
}
`;

export const dockerfileTemplate = `
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3001

CMD ["node", "dist/main.js"]
`;

export const helmValuesTemplate = `
replicaCount: 2

image:
  repository: {{appName}}
  tag: latest
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80
  targetPort: 3001

ingress:
  enabled: true
  hosts:
    - host: {{appName}}.{{env}}.example.com
      paths:
        - path: /
          pathType: Prefix

env:
  - name: NODE_ENV
    value: "{{env}}"
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: {{appName}}-secrets
        key: database-url
  - name: JWT_SECRET
    valueFrom:
      secretKeyRef:
        name: {{appName}}-secrets
        key: jwt-secret

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 256Mi

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
`;

export const nextApiServiceTemplate = `
import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = \`Bearer \${token}\`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

const apiService = {
  get: (url: string, config?: any) => apiClient.get(url, config),
  post: (url: string, data?: any, config?: any) => apiClient.post(url, data, config),
  put: (url: string, data?: any, config?: any) => apiClient.put(url, data, config),
  delete: (url: string, config?: any) => apiClient.delete(url, config),
};

export default apiService;
`;

export const workflowEngineTemplate = `
import { Injectable, Logger } from '@nestjs/common';
import { WorkflowDefinition, WorkflowInstance, WorkflowTask, WorkflowNode, WorkflowEdge } from './workflow.types';

@Injectable()
export class WorkflowEngine {
  private readonly logger = new Logger(WorkflowEngine.name);

  async startInstance(definition: WorkflowDefinition, variables: Record<string, any>): Promise<WorkflowInstance> {
    const startNode = this.findStartNode(definition);
    if (!startNode) {
      throw new Error('Workflow has no start node');
    }

    const instance: WorkflowInstance = {
      id: this.generateId(),
      definitionId: definition.id,
      status: 'running',
      currentNodeIds: [startNode.id],
      variables: { ...variables },
      startedBy: variables.startedBy || 'system',
      startedAt: new Date(),
    };

    await this.executeNode(instance, startNode, definition);
    return instance;
  }

  async completeTask(task: WorkflowTask, data: Record<string, any>): Promise<void> {
    this.logger.log(\`Completing task \${task.id}\`);
  }

  private findStartNode(definition: WorkflowDefinition): WorkflowNode | undefined {
    return definition.nodes.find(n => n.type === 'start');
  }

  private async executeNode(instance: WorkflowInstance, node: WorkflowNode, definition: WorkflowDefinition): Promise<void> {
    this.logger.log(\`Executing node: \${node.type} - \${node.name}\`);

    switch (node.type) {
      case 'start':
        await this.processStart(instance, node, definition);
        break;
      case 'end':
        await this.processEnd(instance);
        break;
      case 'userTask':
        await this.processUserTask(instance, node);
        break;
      case 'serviceTask':
        await this.processServiceTask(instance, node);
        break;
      case 'exclusiveGateway':
        await this.processExclusiveGateway(instance, node, definition);
        break;
      case 'parallelGateway':
        await this.processParallelGateway(instance, node, definition);
        break;
      default:
        this.logger.warn(\`Unknown node type: \${node.type}\`);
    }
  }

  private async processStart(instance: WorkflowInstance, node: WorkflowNode, definition: WorkflowDefinition): Promise<void> {
    const outgoingEdges = this.getOutgoingEdges(definition, node.id);
    for (const edge of outgoingEdges) {
      const nextNode = this.getNodeById(definition, edge.targetId);
      if (nextNode) {
        instance.currentNodeIds = [nextNode.id];
        await this.executeNode(instance, nextNode, definition);
      }
    }
  }

  private async processEnd(instance: WorkflowInstance): Promise<void> {
    instance.status = 'completed';
    instance.endedAt = new Date();
    this.logger.log(\`Workflow \${instance.id} completed\`);
  }

  private async processUserTask(instance: WorkflowInstance, node: WorkflowNode): Promise<void> {
    const task: WorkflowTask = {
      id: this.generateId(),
      instanceId: instance.id,
      nodeId: node.id,
      assignee: node.properties.assignee,
      candidates: node.properties.candidates || [],
      status: 'ready',
      dueDate: node.properties.dueDate ? new Date(node.properties.dueDate) : undefined,
      createdAt: new Date(),
    };
    instance.variables = { ...instance.variables, currentTask: task };
  }

  private async processServiceTask(instance: WorkflowInstance, node: WorkflowNode): Promise<void> {
    const serviceName = node.properties.serviceName;
    const operation = node.properties.operation;
    this.logger.log(\`Executing service task: \${serviceName}.\${operation}\`);
  }

  private async processExclusiveGateway(instance: WorkflowInstance, node: WorkflowNode, definition: WorkflowDefinition): Promise<void> {
    const outgoingEdges = this.getOutgoingEdges(definition, node.id);
    for (const edge of outgoingEdges) {
      if (this.evaluateCondition(edge.condition, instance.variables)) {
        const nextNode = this.getNodeById(definition, edge.targetId);
        if (nextNode) {
          instance.currentNodeIds = [nextNode.id];
          await this.executeNode(instance, nextNode, definition);
        }
        break;
      }
    }
  }

  private async processParallelGateway(instance: WorkflowInstance, node: WorkflowNode, definition: WorkflowDefinition): Promise<void> {
    const outgoingEdges = this.getOutgoingEdges(definition, node.id);
    instance.currentNodeIds = outgoingEdges.map(e => e.targetId);
    for (const edge of outgoingEdges) {
      const nextNode = this.getNodeById(definition, edge.targetId);
      if (nextNode) {
        await this.executeNode(instance, nextNode, definition);
      }
    }
  }

  private getOutgoingEdges(definition: WorkflowDefinition, nodeId: string): WorkflowEdge[] {
    return definition.edges.filter(e => e.sourceId === nodeId);
  }

  private getNodeById(definition: WorkflowDefinition, nodeId: string): WorkflowNode | undefined {
    return definition.nodes.find(n => n.id === nodeId);
  }

  private evaluateCondition(condition: string | undefined, variables: Record<string, any>): boolean {
    if (!condition) return true;
    try {
      const fn = new Function('vars', \`return \${condition};\`);
      return fn(variables);
    } catch (error) {
      this.logger.error(\`Condition evaluation failed: \${condition}\`, error);
      return false;
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}
`;
