import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        parent: true,
        children: true,
        users: { include: { roles: true } },
        roles: true,
        applications: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(id: string, data: { name?: string; description?: string; parentId?: string }) {
    return this.prisma.organization.update({
      where: { id },
      data,
    });
  }

  async getHierarchy(organizationId: string) {
    const orgs = await this.prisma.organization.findMany({
      where: { id: organizationId },
      include: {
        children: {
          include: { children: true },
        },
      },
    });
    return orgs[0];
  }
}
