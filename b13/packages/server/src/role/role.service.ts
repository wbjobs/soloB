import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RoleService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: string) {
    return this.prisma.role.findMany({
      where: { organizationId },
      include: { users: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, organizationId },
      include: {
        users: true,
        pagePermissions: true,
        buttonPermissions: true,
        dataPermissions: true,
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async create(organizationId: string, data: {
    name: string;
    description?: string;
    permissions: any[];
  }) {
    const existing = await this.prisma.role.findFirst({
      where: { name: data.name, organizationId },
    });
    if (existing) throw new BadRequestException('Role with this name already exists');

    return this.prisma.role.create({
      data: {
        name: data.name,
        description: data.description,
        organizationId,
        permissions: data.permissions || [],
      },
    });
  }

  async update(id: string, organizationId: string, data: {
    name?: string;
    description?: string;
    permissions?: any[];
  }) {
    const existing = await this.prisma.role.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Role not found');

    return this.prisma.role.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, organizationId: string) {
    const existing = await this.prisma.role.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Role not found');
    await this.prisma.role.delete({ where: { id } });
  }
}
