import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { OrganizationModule } from './organization/organization.module';
import { RoleModule } from './role/role.module';
import { ApplicationModule } from './application/application.module';
import { PageModule } from './page/page.module';
import { DataModelModule } from './data-model/data-model.module';
import { WorkflowModule } from './workflow/workflow.module';
import { GeneratorModule } from './generator/generator.module';
import { DeploymentModule } from './deployment/deployment.module';
import { CustomComponentModule } from './custom-component/custom-component.module';
import { DataSourceModule } from './data-source/data-source.module';
import { CollaborationModule } from './collaboration/collaboration.module';
import { AIModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 100,
    }),
    PrismaModule,
    AuthModule,
    UserModule,
    OrganizationModule,
    RoleModule,
    ApplicationModule,
    PageModule,
    DataModelModule,
    WorkflowModule,
    GeneratorModule,
    DeploymentModule,
    CustomComponentModule,
    DataSourceModule,
    CollaborationModule,
    AIModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
