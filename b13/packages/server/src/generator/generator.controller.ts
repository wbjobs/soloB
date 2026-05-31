import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Request,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GeneratorService } from './generator.service';
import { Roles } from '../auth/roles.decorator';
import { Response } from 'express';

@ApiTags('generator')
@Controller('applications/:applicationId/generate')
export class GeneratorController {
  constructor(private readonly generatorService: GeneratorService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Preview generated code' })
  async preview(
    @Param('applicationId') applicationId: string,
    @Query('baseApiUrl') baseApiUrl: string,
    @Request() req,
  ) {
    return this.generatorService.generate(
      applicationId,
      req.user.organizationId,
      baseApiUrl,
    );
  }

  @Post('zip')
  @Roles('admin')
  @ApiOperation({ summary: 'Download generated code as ZIP' })
  async downloadZip(
    @Param('applicationId') applicationId: string,
    @Query('baseApiUrl') baseApiUrl: string,
    @Request() req,
    @Res() res: Response,
  ) {
    const zipBuffer = await this.generatorService.generateAndZip(
      applicationId,
      req.user.organizationId,
      baseApiUrl,
    );

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="generated-app.zip"`);
    res.send(zipBuffer);
  }
}
