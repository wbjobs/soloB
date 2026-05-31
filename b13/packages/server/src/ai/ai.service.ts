import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AIConversation,
  AIGeneratedContent,
  AIMessage,
  AIContext,
  AICategory,
  PageGenerationRequest,
  ComponentSuggestionRequest,
  DataModelGenerationRequest,
  WorkflowGenerationRequest,
  AIResponse,
  generateId,
  now,
} from '@lowcode/shared';

const DEFAULT_PROMPTS = {
  page_generation: `你是一个专业的UI/UX设计师和前端工程师。根据用户描述，生成一个完整的页面设计方案。

返回格式要求：
{
  "name": "页面名称",
  "path": "/page-path",
  "title": "页面标题",
  "layout": "布局类型 (grid/flex/stack)",
  "components": [
    {
      "type": "组件类型",
      "props": { "key": "value" },
      "style": { "key": "value" },
      "children": []
    }
  ],
  "stateVariables": {
    "key": "defaultValue"
  }
}

可用组件类型：
- Container, Row, Col, Card, Tabs
- Form, Input, Select, Checkbox, Radio, DatePicker, Button
- Table, Pagination, Text, Image, Divider, Modal
- Chart (bar/line/pie)

请确保返回有效的JSON格式。`,

  component_suggestion: `你是一个UI组件库专家。根据用户的需求，推荐合适的组件组合。

返回格式：
{
  "recommendations": [
    {
      "type": "组件类型",
      "reason": "推荐理由",
      "props": { "defaultProps": "值" },
      "style": { "defaultStyle": "值" }
    }
  ]
}`,

  data_model_generation: `你是一个数据库架构师。根据用户描述，设计数据模型。

返回格式：
{
  "models": [
    {
      "name": "模型名称",
      "tableName": "表名",
      "fields": [
        {
          "name": "字段名",
          "type": "String/Int/Float/Boolean/DateTime/Json/Text/Decimal",
          "isRequired": true/false,
          "isUnique": true/false,
          "isPrimaryKey": true/false,
          "defaultValue": "默认值"
        }
      ],
      "relations": [
        {
          "name": "关系名",
          "type": "one-to-one/one-to-many/many-to-many",
          "targetModel": "目标模型名"
        }
      ],
      "indexes": [
        {
          "fieldNames": ["field1", "field2"],
          "isUnique": true/false
        }
      ]
    }
  ]
}`,

  workflow_generation: `你是一个业务流程专家。根据用户描述，设计BPMN工作流。

返回格式：
{
  "name": "工作流名称",
  "description": "流程描述",
  "nodes": [
    {
      "id": "node_1",
      "type": "start",
      "name": "开始",
      "position": { "x": 100, "y": 100 }
    },
    {
      "id": "node_2",
      "type": "userTask/serviceTask/exclusiveGateway/parallelGateway/end",
      "name": "节点名称",
      "position": { "x": 300, "y": 100 },
      "properties": { "assignee": "审批人", "serviceName": "服务名" }
    }
  ],
  "edges": [
    {
      "id": "edge_1",
      "sourceId": "node_1",
      "targetId": "node_2",
      "condition": "条件表达式 (可选)"
    }
  ]
}

节点类型：
- start: 开始节点
- end: 结束节点  
- userTask: 用户任务
- serviceTask: 服务任务
- exclusiveGateway: 排他网关 (条件分支)
- parallelGateway: 并行网关 (并行分支)`,

  code_explanation: `你是一个资深软件工程师。分析用户提供的代码并给出解释和改进建议。`,

  code_generation: `你是一个全栈开发工程师。根据需求生成高质量的代码。

代码要求：
- TypeScript 严格模式
- 遵循最佳实践
- 包含必要的注释
- 错误处理完整`,
};

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listPrompts(organizationId: string, category?: AICategory) {
    const where: any = { organizationId };
    if (category) where.category = category;

    const systemPrompts = Object.entries(DEFAULT_PROMPTS).map(([key, value]) => ({
      id: `system_${key}`,
      organizationId: null,
      name: this.getPromptName(key as AICategory),
      category: key,
      prompt: value,
      responseFormat: 'json',
      isPublic: true,
      usageCount: 0,
      isSystem: true,
    }));

    const customPrompts = await this.prisma.aIPrompt.findMany({
      where,
      orderBy: { usageCount: 'desc' },
    });

    return [...systemPrompts, ...customPrompts];
  }

  private getPromptName(category: AICategory): string {
    const names: Record<AICategory, string> = {
      page_generation: '页面生成',
      component_suggestion: '组件推荐',
      data_model_generation: '数据模型生成',
      workflow_generation: '工作流生成',
      code_explanation: '代码解释',
      code_generation: '代码生成',
      general: '通用对话',
    };
    return names[category] || category;
  }

  async createConversation(
    organizationId: string,
    userId: string,
    data: {
      title?: string;
      applicationId?: string;
      initialMessage?: string;
      context?: AIContext;
    },
  ) {
    const messages: AIMessage[] = [];
    if (data.initialMessage) {
      messages.push({
        role: 'user',
        content: data.initialMessage,
        timestamp: Date.now(),
      });
    }

    return this.prisma.aIConversation.create({
      data: {
        organizationId,
        userId,
        applicationId: data.applicationId,
        title: data.title || '新对话',
        messages,
        context: data.context || {},
      },
    });
  }

  async listConversations(organizationId: string, userId: string, applicationId?: string) {
    const where: any = { organizationId, userId };
    if (applicationId) where.applicationId = applicationId;

    return this.prisma.aIConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getConversation(id: string, organizationId: string) {
    const conversation = await this.prisma.aIConversation.findFirst({
      where: { id, organizationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async deleteConversation(id: string, organizationId: string) {
    const conversation = await this.prisma.aIConversation.findFirst({
      where: { id, organizationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    await this.prisma.aIGeneratedContent.deleteMany({
      where: { conversationId: id },
    });

    await this.prisma.aIConversation.delete({ where: { id } });
  }

  async sendMessage(
    conversationId: string,
    organizationId: string,
    userId: string,
    userMessage: string,
    options?: {
      category?: AICategory;
      context?: AIContext;
      temperature?: number;
    },
  ): Promise<AIResponse> {
    const conversation = await this.prisma.aIConversation.findFirst({
      where: { id: conversationId, organizationId, userId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const category = options?.category || 'general';
    const systemPrompt = DEFAULT_PROMPTS[category] || DEFAULT_PROMPTS.general;

    const messages: AIMessage[] = [
      ...(conversation.messages as AIMessage[]),
      {
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
      },
    ];

    let aiResponse: AIResponse;

    try {
      aiResponse = await this.callLLM(systemPrompt, messages, options);
    } catch (error) {
      this.logger.error('LLM call failed', error);
      return this.generateMockResponse(category, userMessage);
    }

    const allMessages = [
      ...messages,
      {
        role: 'assistant',
        content: aiResponse.content?.toString() || '',
        timestamp: Date.now(),
      },
    ];

    await this.prisma.aIConversation.update({
      where: { id: conversationId },
      data: {
        messages: allMessages,
        updatedAt: now(),
        title: conversation.title === '新对话'
          ? userMessage.slice(0, 50)
          : conversation.title,
      },
    });

    if (aiResponse.content && this.shouldSaveContent(category)) {
      await this.prisma.aIGeneratedContent.create({
        data: {
          id: generateId(),
          organizationId,
          userId,
          applicationId: conversation.applicationId,
          conversationId,
          contentType: category,
          generatedContent: aiResponse.content,
          sourcePrompt: userMessage,
        },
      });
    }

    return aiResponse;
  }

  private shouldSaveContent(category: AICategory): boolean {
    return ['page_generation', 'data_model_generation', 'workflow_generation', 'code_generation'].includes(category);
  }

  async generatePage(request: PageGenerationRequest, userId: string, organizationId: string): Promise<AIResponse> {
    const conversation = await this.createConversation(organizationId, userId, {
      title: `页面生成: ${request.description.slice(0, 30)}`,
      applicationId: request.applicationId,
    });

    const prompt = `
上下文:
- 现有页面: ${request.context?.existingPages?.join(', ') || '无'}
- 现有数据模型: ${request.context?.existingDataModels?.join(', ') || '无'}

需求: ${request.description}
`;

    return this.sendMessage(conversation.id, organizationId, userId, prompt, {
      category: 'page_generation',
    });
  }

  async suggestComponents(request: ComponentSuggestionRequest, userId: string, organizationId: string): Promise<AIResponse> {
    const conversation = await this.createConversation(organizationId, userId, {
      title: '组件推荐',
    });

    const prompt = `
当前页面:
- 已有组件: ${JSON.stringify(request.pageContext.components)}
- 布局类型: ${request.pageContext.layout}

需求: ${request.description}
`;

    return this.sendMessage(conversation.id, organizationId, userId, prompt, {
      category: 'component_suggestion',
    });
  }

  async generateDataModel(request: DataModelGenerationRequest, userId: string, organizationId: string): Promise<AIResponse> {
    const conversation = await this.createConversation(organizationId, userId, {
      title: `数据模型: ${request.description.slice(0, 30)}`,
    });

    const prompt = `
现有模型: ${request.existingModels?.join(', ') || '无'}

需求: ${request.description}
`;

    return this.sendMessage(conversation.id, organizationId, userId, prompt, {
      category: 'data_model_generation',
    });
  }

  async generateWorkflow(request: WorkflowGenerationRequest, userId: string, organizationId: string): Promise<AIResponse> {
    const conversation = await this.createConversation(organizationId, userId, {
      title: `工作流: ${request.description.slice(0, 30)}`,
      applicationId: request.applicationId,
    });

    const prompt = `
上下文:
- 现有数据模型: ${request.context?.existingDataModels?.join(', ') || '无'}
- 现有页面: ${request.context?.existingPages?.join(', ') || '无'}

需求: ${request.description}
`;

    return this.sendMessage(conversation.id, organizationId, userId, prompt, {
      category: 'workflow_generation',
    });
  }

  private async callLLM(
    systemPrompt: string,
    messages: AIMessage[],
    options?: { temperature?: number },
  ): Promise<AIResponse> {
    const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
    const apiBase = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
    const model = process.env.LLM_MODEL || 'gpt-4o-mini';

    if (!apiKey) {
      this.logger.warn('No LLM API key configured, returning mock response');
      return this.generateMockResponse('general', messages[messages.length - 1]?.content || '');
    }

    try {
      const axios = require('axios');

      const response = await axios.post(
        `${apiBase}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => ({ role: m.role, content: m.content })),
          ],
          temperature: options?.temperature ?? 0.7,
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      const content = response.data.choices[0]?.message?.content;
      const usage = response.data.usage;

      let parsedContent: any = content;
      try {
        parsedContent = JSON.parse(content);
      } catch {
        // 保持原内容
      }

      return {
        success: true,
        content: parsedContent,
        usage: usage && {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
      };
    } catch (error) {
      this.logger.error('LLM API call failed', error);
      throw error;
    }
  }

  private generateMockResponse(category: AICategory, userMessage: string): AIResponse {
    this.logger.log(`Generating mock response for category: ${category}`);

    const mockResponses: Record<AICategory, any> = {
      page_generation: {
        name: '示例页面',
        path: '/example',
        title: '示例页面标题',
        layout: 'flex',
        components: [
          {
            type: 'Container',
            props: { title: '欢迎' },
            style: { padding: '24px' },
            children: [
              {
                type: 'Text',
                props: { text: '这是一个示例页面' },
                style: { fontSize: '18px' },
                children: [],
              },
            ],
          },
        ],
        stateVariables: {},
      },

      component_suggestion: {
        recommendations: [
          {
            type: 'Card',
            reason: '适合展示结构化信息',
            props: { title: '卡片标题' },
            style: { marginBottom: '16px' },
          },
        ],
      },

      data_model_generation: {
        models: [
          {
            name: 'Example',
            tableName: 'examples',
            fields: [
              { name: 'name', type: 'String', isRequired: true, isUnique: false },
              { name: 'description', type: 'Text', isRequired: false },
              { name: 'isActive', type: 'Boolean', isRequired: true, defaultValue: true },
            ],
            relations: [],
            indexes: [],
          },
        ],
      },

      workflow_generation: {
        name: '示例流程',
        description: '这是一个示例工作流',
        nodes: [
          { id: 'start_1', type: 'start', name: '开始', position: { x: 100, y: 200 } },
          { id: 'task_1', type: 'userTask', name: '审批', position: { x: 350, y: 200 }, properties: { assignee: 'admin' } },
          { id: 'end_1', type: 'end', name: '结束', position: { x: 600, y: 200 } },
        ],
        edges: [
          { id: 'edge_1', sourceId: 'start_1', targetId: 'task_1' },
          { id: 'edge_2', sourceId: 'task_1', targetId: 'end_1' },
        ],
      },

      general: {
        message: '我理解了您的需求。请提供更多细节，我可以帮您完成设计。',
      },

      code_explanation: {
        summary: '这段代码的主要功能是...',
        suggestions: ['建议1', '建议2'],
      },

      code_generation: {
        code: '// 生成的代码示例\nfunction example() {\n  return "hello";\n}',
        explanation: '这段代码实现了...',
      },
    };

    return {
      success: true,
      content: mockResponses[category] || mockResponses.general,
    };
  }

  async rateContent(id: string, organizationId: string, rating: number, feedback?: string) {
    const content = await this.prisma.aIGeneratedContent.findFirst({
      where: { id, organizationId },
    });

    if (!content) {
      throw new NotFoundException('Generated content not found');
    }

    return this.prisma.aIGeneratedContent.update({
      where: { id },
      data: { rating, feedback },
    });
  }

  async listGeneratedContent(
    organizationId: string,
    filters?: {
      userId?: string;
      applicationId?: string;
      contentType?: AICategory;
    },
  ) {
    const where: any = { organizationId };
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.applicationId) where.applicationId = filters.applicationId;
    if (filters?.contentType) where.contentType = filters.contentType;

    return this.prisma.aIGeneratedContent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }
}
