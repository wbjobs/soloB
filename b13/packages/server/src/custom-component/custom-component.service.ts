import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CustomComponent,
  CustomComponentVersion,
  CustomComponentPropsDefinition,
  CustomComponentEventsDefinition,
  CustomComponentSlotsDefinition,
  ComponentCategory,
  PackageType,
  generateId,
  now,
} from '@lowcode/shared';

@Injectable()
export class CustomComponentService {
  private readonly logger = new Logger(CustomComponentService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toCustomComponent(db: any): CustomComponent {
    return {
      id: db.id,
      organizationId: db.organizationId,
      name: db.name,
      displayName: db.displayName,
      description: db.description,
      category: db.category as ComponentCategory,
      version: db.version,
      packageType: db.packageType as PackageType,
      umdUrl: db.umdUrl,
      npmPackage: db.npmPackage,
      npmVersion: db.npmVersion,
      propsDefinition: (db.propsDefinition || []) as CustomComponentPropsDefinition[],
      eventsDefinition: (db.eventsDefinition || []) as CustomComponentEventsDefinition[],
      slotsDefinition: (db.slotsDefinition || []) as CustomComponentSlotsDefinition[],
      previewImage: db.previewImage,
      documentation: db.documentation,
      tags: (db.tags || []) as string[],
      isPublic: db.isPublic,
      isDeprecated: db.isDeprecated,
      downloads: db.downloads,
      createdBy: db.createdBy,
      createdAt: db.createdAt,
      updatedAt: db.updatedAt,
    };
  }

  private toCustomComponentVersion(db: any): CustomComponentVersion {
    return {
      id: db.id,
      componentId: db.componentId,
      version: db.version,
      changelog: db.changelog,
      umdUrl: db.umdUrl,
      npmVersion: db.npmVersion,
      isLatest: db.isLatest,
      createdAt: db.createdAt,
    };
  }

  async list(organizationId: string, filters?: {
    category?: ComponentCategory;
    search?: string;
    isPublic?: boolean;
    isDeprecated?: boolean;
  }) {
    const where: any = { organizationId };

    if (filters?.category) {
      where.category = filters.category;
    }
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search } },
        { displayName: { contains: filters.search } },
        { description: { contains: filters.search } },
      ];
    }
    if (filters?.isPublic !== undefined) {
      where.isPublic = filters.isPublic;
    }
    if (filters?.isDeprecated !== undefined) {
      where.isDeprecated = filters.isDeprecated;
    }

    const components = await this.prisma.customComponent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { versions: true },
    });

    return components.map(c => this.toCustomComponent(c));
  }

  async get(id: string, organizationId: string) {
    const component = await this.prisma.customComponent.findFirst({
      where: { id, organizationId },
      include: { versions: true },
    });
    if (!component) throw new NotFoundException('Component not found');
    return this.toCustomComponent(component);
  }

  async create(organizationId: string, userId: string, data: {
    name: string;
    displayName: string;
    description?: string;
    category?: ComponentCategory;
    version?: string;
    packageType: PackageType;
    umdUrl?: string;
    npmPackage?: string;
    npmVersion?: string;
    propsDefinition?: CustomComponentPropsDefinition[];
    eventsDefinition?: CustomComponentEventsDefinition[];
    slotsDefinition?: CustomComponentSlotsDefinition[];
    previewImage?: string;
    documentation?: string;
    tags?: string[];
    isPublic?: boolean;
  }) {
    const existing = await this.prisma.customComponent.findFirst({
      where: {
        organizationId,
        name: data.name,
      },
    });
    if (existing) {
      throw new BadRequestException('Component with this name already exists');
    }

    const component = await this.prisma.customComponent.create({
      data: {
        organizationId,
        createdBy: userId,
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        category: data.category || 'custom',
        version: data.version || '1.0.0',
        packageType: data.packageType,
        umdUrl: data.umdUrl,
        npmPackage: data.npmPackage,
        npmVersion: data.npmVersion,
        propsDefinition: data.propsDefinition || [],
        eventsDefinition: data.eventsDefinition || [],
        slotsDefinition: data.slotsDefinition || [],
        previewImage: data.previewImage,
        documentation: data.documentation,
        tags: data.tags || [],
        isPublic: data.isPublic || false,
      },
    });

    await this.prisma.customComponentVersion.create({
      data: {
        componentId: component.id,
        version: component.version,
        umdUrl: component.umdUrl,
        npmVersion: component.npmVersion,
        isLatest: true,
      },
    });

    return this.get(component.id, organizationId);
  }

  async update(id: string, organizationId: string, data: Partial<{
    displayName: string;
    description: string;
    category: ComponentCategory;
    isPublic: boolean;
    isDeprecated: boolean;
    propsDefinition: CustomComponentPropsDefinition[];
    eventsDefinition: CustomComponentEventsDefinition[];
    slotsDefinition: CustomComponentSlotsDefinition[];
    previewImage: string;
    documentation: string;
    tags: string[];
  }>) {
    const existing = await this.prisma.customComponent.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Component not found');

    const updateData: any = { updatedAt: now() };
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;
    if (data.isDeprecated !== undefined) updateData.isDeprecated = data.isDeprecated;
    if (data.propsDefinition !== undefined) updateData.propsDefinition = data.propsDefinition;
    if (data.eventsDefinition !== undefined) updateData.eventsDefinition = data.eventsDefinition;
    if (data.slotsDefinition !== undefined) updateData.slotsDefinition = data.slotsDefinition;
    if (data.previewImage !== undefined) updateData.previewImage = data.previewImage;
    if (data.documentation !== undefined) updateData.documentation = data.documentation;
    if (data.tags !== undefined) updateData.tags = data.tags;

    const updated = await this.prisma.customComponent.update({
      where: { id },
      data: updateData,
    });

    return this.toCustomComponent(updated);
  }

  async createVersion(id: string, organizationId: string, data: {
    version: string;
    changelog?: string;
    umdUrl?: string;
    npmVersion?: string;
  }) {
    const component = await this.prisma.customComponent.findFirst({
      where: { id, organizationId },
    });
    if (!component) throw new NotFoundException('Component not found');

    const existingVersion = await this.prisma.customComponentVersion.findFirst({
      where: { componentId: id, version: data.version },
    });
    if (existingVersion) {
      throw new BadRequestException('Version already exists');
    }

    await this.prisma.customComponentVersion.updateMany({
      where: { componentId: id, isLatest: true },
      data: { isLatest: false },
    });

    const version = await this.prisma.customComponentVersion.create({
      data: {
        componentId: id,
        version: data.version,
        changelog: data.changelog,
        umdUrl: data.umdUrl,
        npmVersion: data.npmVersion,
        isLatest: true,
      },
    });

    await this.prisma.customComponent.update({
      where: { id },
      data: {
        version: data.version,
        umdUrl: data.umdUrl,
        npmVersion: data.npmVersion,
        updatedAt: now(),
      },
    });

    return this.toCustomComponentVersion(version);
  }

  async delete(id: string, organizationId: string) {
    const existing = await this.prisma.customComponent.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Component not found');

    await this.prisma.customComponentVersion.deleteMany({
      where: { componentId: id },
    });

    await this.prisma.customComponent.delete({ where: { id } });
  }

  async incrementDownload(id: string, organizationId: string) {
    const existing = await this.prisma.customComponent.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Component not found');

    await this.prisma.customComponent.update({
      where: { id },
      data: { downloads: { increment: 1 } },
    });
  }

  async listVersions(id: string, organizationId: string) {
    const component = await this.prisma.customComponent.findFirst({
      where: { id, organizationId },
    });
    if (!component) throw new NotFoundException('Component not found');

    const versions = await this.prisma.customComponentVersion.findMany({
      where: { componentId: id },
      orderBy: { createdAt: 'desc' },
    });

    return versions.map(v => this.toCustomComponentVersion(v));
  }

  async getLatestVersion(id: string, organizationId: string) {
    const version = await this.prisma.customComponentVersion.findFirst({
      where: { componentId: id, isLatest: true },
    });
    if (!version) throw new NotFoundException('No version found');
    return this.toCustomComponentVersion(version);
  }
}
