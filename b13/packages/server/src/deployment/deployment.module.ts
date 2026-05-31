import { Module } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { EnvironmentController, DeploymentController } from './deployment.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { GeneratorModule } from '../generator/generator.module';

@Module({
  imports: [PrismaModule, GeneratorModule],
  controllers: [EnvironmentController, DeploymentController],
  providers: [DeploymentService],
  exports: [DeploymentService],
})
export class DeploymentModule {}
