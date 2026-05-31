import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateProject, GeneratorContext, GeneratedFile } from '@lowcode/code-generator';
import { PageSchema, DataModel, WorkflowDefinition } from '@lowcode/shared';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class GeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(applicationId: string, organizationId: string, baseApiUrl?: string): Promise<GeneratedFile[]> {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, organizationId },
      include: {
        pageSchemas: true,
        dataModels: true,
        workflows: true,
      },
    });

    if (!app) throw new NotFoundException('Application not found');

    const pages: PageSchema[] = app.pageSchemas.map((p: any) => ({
      id: p.id,
      applicationId: p.applicationId,
      name: p.name,
      path: p.path,
      title: p.title,
      description: p.description,
      components: p.componentsJson || [],
      stateVariables: p.stateVariables || {},
      isLayout: p.isLayout || false,
      layoutId: p.layoutId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    const dataModels: DataModel[] = app.dataModels.map((m: any) => ({
      id: m.id,
      applicationId: m.applicationId,
      name: m.name,
      tableName: m.tableName,
      description: m.description,
      fields: m.fieldsJson || [],
      relations: m.relationsJson || [],
      indexes: m.indexesJson || [],
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));

    const workflows: WorkflowDefinition[] = app.workflows.map((w: any) => ({
      id: w.id,
      applicationId: w.applicationId,
      name: w.name,
      description: w.description,
      nodes: w.nodesJson || [],
      edges: w.edgesJson || [],
      version: w.version,
      status: w.status as any,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    }));

    const context: GeneratorContext = {
      projectName: this.sanitizeProjectName(app.name),
      pages,
      dataModels,
      workflows,
      baseApiUrl,
    };

    return generateProject(context);
  }

  async generateAndZip(applicationId: string, organizationId: string, baseApiUrl?: string): Promise<Buffer> {
    const files = await this.generate(applicationId, organizationId, baseApiUrl);
    
    const { createWriteStream } = await import('fs');
    const archiver = await import('archiver');
    const { PassThrough } = await import('stream');

    return new Promise((resolve, reject) => {
      const buffer: Buffer[] = [];
      const output = new PassThrough();
      
      output.on('data', (chunk) => buffer.push(chunk));
      output.on('end', () => resolve(Buffer.concat(buffer)));
      output.on('error', reject);

      const archive = archiver.default('zip', { zlib: { level: 9 } });
      archive.pipe(output);

      files.forEach(file => {
        archive.append(file.content, { name: file.path });
      });

      archive.finalize();
    });
  }

  async downloadToPath(
    applicationId: string,
    organizationId: string,
    outputPath: string,
    baseApiUrl?: string
  ): Promise<void> {
    const files = await this.generate(applicationId, organizationId, baseApiUrl);

    for (const file of files) {
      const fullPath = path.join(outputPath, file.path);
      const dirPath = path.dirname(fullPath);
      
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      fs.writeFileSync(fullPath, file.content, 'utf8');
    }
  }

  private sanitizeProjectName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'my-app';
  }
}
