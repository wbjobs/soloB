import { Module } from '@nestjs/common';
import { CustomComponentController } from './custom-component.controller';
import { CustomComponentService } from './custom-component.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CustomComponentController],
  providers: [CustomComponentService],
  exports: [CustomComponentService],
})
export class CustomComponentModule {}
