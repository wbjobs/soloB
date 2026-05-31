import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        roles: true,
        organization: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { passwordHash, ...result } = user;
    return result;
  }

  async login(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      organizationId: user.organizationId,
      roles: user.roles.map((r: any) => r.name),
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        organization: user.organization,
        roles: user.roles,
      },
    };
  }

  async register(data: {
    email: string;
    password: string;
    username: string;
    organizationName: string;
  }) {
    const passwordHash = await bcrypt.hash(data.password, 10);

    return this.prisma.$transaction(async (prisma) => {
      const organization = await prisma.organization.create({
        data: {
          name: data.organizationName,
        },
      });

      const adminRole = await prisma.role.create({
        data: {
          name: 'admin',
          organizationId: organization.id,
          permissions: [{ resource: '*', action: '*', scope: 'all' }],
        },
      });

      const user = await prisma.user.create({
        data: {
          email: data.email,
          username: data.username,
          passwordHash,
          organizationId: organization.id,
          roles: {
            connect: { id: adminRole.id },
          },
        },
        include: {
          roles: true,
          organization: true,
        },
      });

      await prisma.role.create({
        data: {
          name: 'user',
          organizationId: organization.id,
          permissions: [
            { resource: 'application', action: 'read', scope: 'organization' },
            { resource: 'page', action: 'read', scope: 'organization' },
          ],
        },
      });

      const payload = {
        sub: user.id,
        email: user.email,
        username: user.username,
        organizationId: user.organizationId,
        roles: user.roles.map((r: any) => r.name),
      };

      return {
        access_token: this.jwtService.sign(payload),
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          organization: user.organization,
          roles: user.roles,
        },
      };
    });
  }
}
