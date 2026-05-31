import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PageSchema, PageComponent, generateId, now } from '@lowcode/shared';

@Injectable()
export class PageService {
  constructor(private readonly prisma: PrismaService) {}

  private toPageSchema(db: any): PageSchema {
    return {
      id: db.id,
      applicationId: db.applicationId,
      name: db.name,
      path: db.path,
      title: db.title,
      description: db.description,
      components: db.componentsJson,
      stateVariables: db.stateVariables || {},
      isLayout: db.isLayout || false,
      layoutId: db.layoutId,
      createdAt: db.createdAt,
      updatedAt: db.updatedAt,
    };
  }

  async findAll(applicationId: string) {
    const pages = await this.prisma.pageSchema.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'asc' },
    });
    return pages.map(p => this.toPageSchema(p));
  }

  async findOne(id: string, applicationId: string) {
    const page = await this.prisma.pageSchema.findFirst({
      where: { id, applicationId },
    });
    if (!page) throw new NotFoundException('Page not found');
    return this.toPageSchema(page);
  }

  async create(applicationId: string, data: {
    name: string;
    path: string;
    title?: string;
    description?: string;
    isLayout?: boolean;
  }) {
    const existing = await this.prisma.pageSchema.findFirst({
      where: { applicationId, path: data.path },
    });
    if (existing) throw new BadRequestException('Page with this path already exists');

    const page = await this.prisma.pageSchema.create({
      data: {
        applicationId,
        name: data.name,
        path: data.path,
        title: data.title,
        description: data.description,
        isLayout: data.isLayout || false,
        componentsJson: [],
        stateVariables: {},
      },
    });
    return this.toPageSchema(page);
  }

  async update(id: string, applicationId: string, data: {
    name?: string;
    path?: string;
    title?: string;
    description?: string;
    isLayout?: boolean;
    components?: PageComponent[];
    stateVariables?: Record<string, any>;
  }) {
    const existing = await this.prisma.pageSchema.findFirst({ where: { id, applicationId } });
    if (!existing) throw new NotFoundException('Page not found');

    const updateData: any = {
      updatedAt: now(),
    };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.path !== undefined) updateData.path = data.path;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.isLayout !== undefined) updateData.isLayout = data.isLayout;
    if (data.components !== undefined) updateData.componentsJson = data.components;
    if (data.stateVariables !== undefined) updateData.stateVariables = data.stateVariables;

    const page = await this.prisma.pageSchema.update({
      where: { id },
      data: updateData,
    });
    return this.toPageSchema(page);
  }

  async remove(id: string, applicationId: string) {
    const existing = await this.prisma.pageSchema.findFirst({ where: { id, applicationId } });
    if (!existing) throw new NotFoundException('Page not found');
    await this.prisma.pageSchema.delete({ where: { id } });
  }

  async setPermissions(pageId: string, applicationId: string, permissions: {
    roleId: string;
    canView: boolean;
    canEdit: boolean;
  }[]) {
    const page = await this.findOne(pageId, applicationId);
    
    await this.prisma.pagePermission.deleteMany({ where: { pageId } });
    
    if (permissions.length > 0) {
      await this.prisma.pagePermission.createMany({
        data: permissions.map(p => ({
          pageId,
          roleId: p.roleId,
          canView: p.canView,
          canEdit: p.canEdit,
        })),
      });
    }
  }
}
