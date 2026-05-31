import { Module } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { WorkflowController, WorkflowTaskController } from './workflow.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WorkflowController, WorkflowTaskController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
