import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateVersion } from '@lowcode/shared';

@Injectable()
export class ApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: string, query: any = {}) {
    return this.prisma.application.findMany({
      where: {
        organizationId,
        ...(query.search && {
          name: { contains: query.search },
        }),
      },
      include: {
        environments: true,
        versions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const app = await this.prisma.application.findFirst({
      where: { id, organizationId },
      include: {
        environments: true,
        versions: {
          orderBy: { createdAt: 'desc' },
        },
        pageSchemas: true,
        dataModels: true,
        workflows: true,
      },
    });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }

  async create(organizationId: string, createdBy: string, data: {
    name: string;
    description?: string;
  }) {
    return this.prisma.$transaction(async (prisma) => {
      const app = await prisma.application.create({
        data: {
          name: data.name,
          description: data.description,
          organizationId,
          createdBy,
        },
      });

      await prisma.environment.createMany({
        data: [
          { name: 'Development', type: 'dev', applicationId: app.id },
          { name: 'Staging', type: 'staging', applicationId: app.id },
          { name: 'Production', type: 'prod', applicationId: app.id },
        ],
      });

      return app;
    });
  }

  async update(id: string, organizationId: string, data: {
    name?: string;
    description?: string;
    status?: string;
  }) {
    const existing = await this.prisma.application.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Application not found');

    return this.prisma.application.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, organizationId: string) {
    const existing = await this.prisma.application.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Application not found');
    await this.prisma.application.delete({ where: { id } });
  }

  async createVersion(id: string, organizationId: string, description?: string) {
    const app = await this.findOne(id, organizationId);

    const [pages, dataModels, workflows] = await Promise.all([
      this.prisma.pageSchema.findMany({ where: { applicationId: id } }),
      this.prisma.dataModelDb.findMany({ where: { applicationId: id } }),
      this.prisma.workflowDefinitionDb.findMany({ where: { applicationId: id } }),
    ]);

    const version = await this.prisma.applicationVersion.create({
      data: {
        applicationId: id,
        version: generateVersion(),
        description,
        pageSchemasJson: pages,
        dataModelsJson: dataModels,
        workflowsJson: workflows,
      },
    });

    await this.prisma.application.update({
      where: { id },
      data: { currentVersionId: version.id },
    });

    return version;
  }

  async getVersions(id: string, organizationId: string) {
    const app = await this.findOne(id, organizationId);
    return this.prisma.applicationVersion.findMany({
      where: { applicationId: id },
      orderBy: { createdAt: 'desc' },
    });
  }
}
