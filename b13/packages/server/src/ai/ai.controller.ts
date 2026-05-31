import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AIService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  AICategory,
  PageGenerationRequest,
  ComponentSuggestionRequest,
  DataModelGenerationRequest,
  WorkflowGenerationRequest,
} from '@lowcode/shared';

@ApiTags('AI')
@ApiBearerAuth()
@Controller('api/ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Get('prompts')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'List available AI prompts' })
  async listPrompts(
    @Req() req: any,
    @Query('category') category?: AICategory,
  ) {
    return this.aiService.listPrompts(req.user.organizationId, category);
  }

  @Post('conversations')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Create new AI conversation' })
  async createConversation(
    @Req() req: any,
    @Body()
    data: {
      title?: string;
      applicationId?: string;
      initialMessage?: string;
      context?: any;
    },
  ) {
    return this.aiService.createConversation(
      req.user.organizationId,
      req.user.userId,
      data,
    );
  }

  @Get('conversations')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'List conversations' })
  async listConversations(
    @Req() req: any,
    @Query('applicationId') applicationId?: string,
  ) {
    return this.aiService.listConversations(
      req.user.organizationId,
      req.user.userId,
      applicationId,
    );
  }

  @Get('conversations/:id')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Get conversation by ID' })
  async getConversation(@Param('id') id: string, @Req() req: any) {
    return this.aiService.getConversation(id, req.user.organizationId);
  }

  @Delete('conversations/:id')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Delete conversation' })
  async deleteConversation(@Param('id') id: string, @Req() req: any) {
    await this.aiService.deleteConversation(id, req.user.organizationId);
    return { success: true };
  }

  @Post('conversations/:id/messages')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Send message to conversation' })
  async sendMessage(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    data: {
      message: string;
      category?: AICategory;
      context?: any;
      temperature?: number;
    },
  ) {
    return this.aiService.sendMessage(
      id,
      req.user.organizationId,
      req.user.userId,
      data.message,
      {
        category: data.category,
        context: data.context,
        temperature: data.temperature,
      },
    );
  }

  @Post('generate/page')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Generate page from description' })
  async generatePage(
    @Req() req: any,
    @Body() request: PageGenerationRequest,
  ) {
    return this.aiService.generatePage(request, req.user.userId, req.user.organizationId);
  }

  @Post('suggest/components')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Get component suggestions' })
  async suggestComponents(
    @Req() req: any,
    @Body() request: ComponentSuggestionRequest,
  ) {
    return this.aiService.suggestComponents(request, req.user.userId, req.user.organizationId);
  }

  @Post('generate/data-model')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Generate data model from description' })
  async generateDataModel(
    @Req() req: any,
    @Body() request: DataModelGenerationRequest,
  ) {
    return this.aiService.generateDataModel(request, req.user.userId, req.user.organizationId);
  }

  @Post('generate/workflow')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Generate workflow from description' })
  async generateWorkflow(
    @Req() req: any,
    @Body() request: WorkflowGenerationRequest,
  ) {
    return this.aiService.generateWorkflow(request, req.user.userId, req.user.organizationId);
  }

  @Put('generated/:id/rate')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'Rate generated content' })
  async rateContent(
    @Param('id') id: string,
    @Req() req: any,
    @Body() data: { rating: number; feedback?: string },
  ) {
    return this.aiService.rateContent(
      id,
      req.user.organizationId,
      data.rating,
      data.feedback,
    );
  }

  @Get('generated')
  @Roles('admin', 'user')
  @ApiOperation({ summary: 'List generated content' })
  async listGeneratedContent(
    @Req() req: any,
    @Query('applicationId') applicationId?: string,
    @Query('contentType') contentType?: AICategory,
  ) {
    return this.aiService.listGeneratedContent(req.user.organizationId, {
      applicationId,
      contentType,
    });
  }
}
