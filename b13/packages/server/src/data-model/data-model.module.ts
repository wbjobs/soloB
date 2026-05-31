import { Module } from '@nestjs/common';
import { DataModelService } from './data-model.service';
import { DataModelController } from './data-model.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DataModelController],
  providers: [DataModelService],
  exports: [DataModelService],
})
export class DataModelModule {}
