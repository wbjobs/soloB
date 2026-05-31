import {
  PageSchema,
  DataModel,
  WorkflowDefinition,
  EventHandler,
  toPascalCase,
  toCamelCase,
} from '@lowcode/shared';
import { GeneratedFile, GeneratorContext } from './types';
import {
  renderPrismaSchema,
  renderEntity,
  renderController,
  renderService,
  renderModule,
  renderAppModule,
  renderMain,
  renderNextPage,
  renderNextPackageJson,
  renderNestPackageJson,
  renderDockerfile,
  renderHelmValues,
  renderNextApiService,
  renderWorkflowEngine,
} from './renderers';

function extractEventHandlers(page: PageSchema): EventHandler[] {
  const handlers: EventHandler[] = [];
  
  function collectFromComponent(component: any) {
    if (component.events && component.events.length > 0) {
      handlers.push(...component.events);
    }
    if (component.children && component.children.length > 0) {
      component.children.forEach(collectFromComponent);
    }
  }
  
  page.components.forEach(collectFromComponent);
  return handlers;
}

function extractOnLoadHandlers(page: PageSchema): EventHandler[] {
  return page.components
    .flatMap(c => c.events || [])
    .filter(e => e.event === 'onLoad');
}

function generateBackendFiles(
  projectName: string,
  dataModels: DataModel[],
  workflows: WorkflowDefinition[]
): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const modelNames = dataModels.map(m => m.name);

  files.push({
    path: `${projectName}-backend/prisma/schema.prisma`,
    content: renderPrismaSchema(dataModels),
  });

  files.push({
    path: `${projectName}-backend/package.json`,
    content: renderNestPackageJson(projectName),
  });

  files.push({
    path: `${projectName}-backend/src/main.ts`,
    content: renderMain(projectName),
  });

  files.push({
    path: `${projectName}-backend/src/app.module.ts`,
    content: renderAppModule(modelNames),
  });

  files.push({
    path: `${projectName}-backend/Dockerfile`,
    content: renderDockerfile(),
  });

  files.push({
    path: `${projectName}-backend/helm/values.yaml`,
    content: renderHelmValues(projectName, 'dev'),
  });

  dataModels.forEach(model => {
    const modelName = toCamelCase(model.name);
    const pascalName = toPascalCase(model.name);

    files.push({
      path: `${projectName}-backend/src/${modelName}/entities/${modelName}.entity.ts`,
      content: renderEntity(model),
    });

    files.push({
      path: `${projectName}-backend/src/${modelName}/${modelName}.controller.ts`,
      content: renderController(model),
    });

    files.push({
      path: `${projectName}-backend/src/${modelName}/${modelName}.service.ts`,
      content: renderService(model),
    });

    files.push({
      path: `${projectName}-backend/src/${modelName}/${modelName}.module.ts`,
      content: renderModule(model),
    });
  });

  if (workflows.length > 0) {
    files.push({
      path: `${projectName}-backend/src/workflow/workflow.engine.ts`,
      content: renderWorkflowEngine(),
    });

    files.push({
      path: `${projectName}-backend/src/workflow/workflow.types.ts`,
      content: `
export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: any[];
  edges: any[];
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  status: 'running' | 'completed' | 'suspended' | 'failed';
  currentNodeIds: string[];
  variables: Record<string, any>;
  startedBy: string;
  startedAt: Date;
  endedAt?: Date;
}

export interface WorkflowTask {
  id: string;
  instanceId: string;
  nodeId: string;
  assignee?: string;
  candidates: string[];
  status: 'ready' | 'claimed' | 'completed' | 'rejected';
  dueDate?: Date;
  createdAt: Date;
  completedAt?: Date;
}
`,
    });
  }

  files.push({
    path: `${projectName}-backend/src/prisma/prisma.service.ts`,
    content: `
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: any) {
    this.$on('beforeExit' as never, async () => {
      await app.close();
    });
  }
}
`,
  });

  files.push({
    path: `${projectName}-backend/src/prisma/prisma.module.ts`,
    content: `
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
`,
  });

  files.push({
    path: `${projectName}-backend/src/auth/jwt-auth.guard.ts`,
    content: `
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) return false;

    const [bearer, token] = authHeader.split(' ');
    if (bearer !== 'Bearer' || !token) return false;

    try {
      const payload = this.jwtService.verify(token);
      request.user = payload;
      return true;
    } catch {
      return false;
    }
  }
}
`,
  });

  files.push({
    path: `${projectName}-backend/src/auth/roles.guard.ts`,
    content: `
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.get<string[]>('roles', context.getHandler());
    if (!roles) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return false;
    return user.roles?.some((role: string) => roles.includes(role)) ?? false;
  }
}
`,
  });

  files.push({
    path: `${projectName}-backend/src/auth/roles.decorator.ts`,
    content: `
import { SetMetadata } from '@nestjs/common';

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
`,
  });

  files.push({
    path: `${projectName}-backend/src/auth/auth.module.ts`,
    content: `
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  providers: [JwtAuthGuard, RolesGuard],
  exports: [JwtModule, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
`,
  });

  return files;
}

function generateFrontendFiles(
  projectName: string,
  pages: PageSchema[],
  baseApiUrl?: string
): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  files.push({
    path: `${projectName}-frontend/package.json`,
    content: renderNextPackageJson(projectName),
  });

  files.push({
    path: `${projectName}-frontend/next.config.js`,
    content: `
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
`,
  });

  files.push({
    path: `${projectName}-frontend/services/api.ts`,
    content: renderNextApiService(),
  });

  files.push({
    path: `${projectName}-frontend/pages/_app.tsx`,
    content: `
import type { AppProps } from 'next/app';
import 'antd/dist/reset.css';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
`,
  });

  files.push({
    path: `${projectName}-frontend/pages/_document.tsx`,
    content: `
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
`,
  });

  pages.forEach(page => {
    const pagePath = page.path.startsWith('/') ? page.path.slice(1) : page.path;
    const fileName = pagePath === '' ? 'index' : pagePath;
    const onLoadHandlers = extractOnLoadHandlers(page);
    const eventHandlers = extractEventHandlers(page).filter(e => e.event !== 'onLoad');

    files.push({
      path: `${projectName}-frontend/pages/${fileName}.tsx`,
      content: renderNextPage({
        ...page,
        onLoadHandlers,
        eventHandlers,
      }),
    });
  });

  files.push({
    path: `${projectName}-frontend/Dockerfile`,
    content: `
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
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["npm", "start"]
`,
  });

  return files;
}

export function generateProject(context: GeneratorContext): GeneratedFile[] {
  const { projectName, pages, dataModels, workflows, baseApiUrl } = context;

  const backendFiles = generateBackendFiles(projectName, dataModels, workflows);
  const frontendFiles = generateFrontendFiles(projectName, pages, baseApiUrl);

  const dockerCompose = `
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: ${projectName}
      POSTGRES_PASSWORD: ${projectName}123
      POSTGRES_DB: ${projectName}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  backend:
    build: ./${projectName}-backend
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://${projectName}:${projectName}123@postgres:5432/${projectName}
      JWT_SECRET: development-secret-key
    depends_on:
      - postgres

  frontend:
    build: ./${projectName}-frontend
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:3001
    depends_on:
      - backend

volumes:
  postgres_data:
`;

  const rootFiles: GeneratedFile[] = [
    {
      path: 'docker-compose.yml',
      content: dockerCompose,
    },
    {
      path: '.env.example',
      content: `
DATABASE_URL=postgresql://${projectName}:${projectName}123@localhost:5432/${projectName}
JWT_SECRET=your-secret-key-here
NEXT_PUBLIC_API_URL=http://localhost:3001
`,
    },
    {
      path: 'README.md',
      content: `
# ${projectName}

Generated Low-Code Application

## Getting Started

### Prerequisites
- Node.js 20+
- Docker and Docker Compose

### Development

1. Install dependencies:
\`\`\`bash
cd ${projectName}-backend && npm install
cd ../${projectName}-frontend && npm install
\`\`\`

2. Set up environment variables:
\`\`\`bash
cp .env.example .env
\`\`\`

3. Start databases:
\`\`\`bash
docker-compose up -d postgres
\`\`\`

4. Run migrations:
\`\`\`bash
cd ${projectName}-backend && npm run prisma:migrate
\`\`\`

5. Start services:
\`\`\`bash
# Backend
cd ${projectName}-backend && npm run dev

# Frontend (in another terminal)
cd ${projectName}-frontend && npm run dev
\`\`\`

### Using Docker Compose

\`\`\`bash
docker-compose up --build
\`\`\`

## Architecture

- **Backend**: NestJS + Prisma + PostgreSQL
- **Frontend**: Next.js + React + Ant Design
- **API**: RESTful with JWT authentication
- **Docs**: Swagger at /docs

## Project Structure

\`\`\`
.
├── ${projectName}-backend/
│   ├── src/
│   │   ├── auth/
│   │   ├── prisma/
│   │   ├── workflow/
${dataModels.map(m => `│   │   ├── ${toCamelCase(m.name)}/`).join('\n')}
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── prisma/
│   │   └── schema.prisma
│   ├── helm/
│   └── Dockerfile
├── ${projectName}-frontend/
│   ├── pages/
│   ├── services/
│   └── Dockerfile
└── docker-compose.yml
\`\`\`
`,
    },
  ];

  return [...rootFiles, ...backendFiles, ...frontendFiles];
}
