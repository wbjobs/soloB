import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: string, query: any = {}) {
    return this.prisma.user.findMany({
      where: {
        organizationId,
        ...(query.search && {
          OR: [
            { username: { contains: query.search } },
            { email: { contains: query.search } },
          ],
        }),
      },
      include: { roles: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId },
      include: { roles: true, organization: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, ...result } = user;
    return result;
  }

  async create(organizationId: string, data: {
    email: string;
    password: string;
    username: string;
    roleIds: string[];
  }) {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: data.email }, { username: data.username }],
        organizationId,
      },
    });
    if (existing) throw new BadRequestException('User with this email or username already exists');

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        passwordHash,
        organizationId,
        roles: {
          connect: data.roleIds?.map(id => ({ id })) || [],
        },
      },
      include: { roles: true },
    });
    const { passwordHash: _, ...result } = user;
    return result;
  }

  async update(id: string, organizationId: string, data: {
    email?: string;
    password?: string;
    username?: string;
    roleIds?: string[];
    isActive?: boolean;
  }) {
    const existing = await this.prisma.user.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('User not found');

    const updateData: any = {};
    if (data.email) updateData.email = data.email;
    if (data.username) updateData.username = data.username;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);
    if (typeof data.isActive !== 'undefined') updateData.isActive = data.isActive;
    if (data.roleIds) {
      updateData.roles = {
        set: data.roleIds.map(id => ({ id })),
      };
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
      include: { roles: true },
    });
    const { passwordHash: _, ...result } = user;
    return result;
  }

  async remove(id: string, organizationId: string) {
    const existing = await this.prisma.user.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('User not found');
    await this.prisma.user.delete({ where: { id } });
  }
}
