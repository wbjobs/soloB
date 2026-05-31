const { OpenAI } = require('openai');

let openaiClient = null;
const isEnabled = () => {
  return !!process.env.OPENAI_API_KEY;
};

const getClient = () => {
  if (!openaiClient && isEnabled()) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined
    });
  }
  return openaiClient;
};

const getCompletion = async (messages, options = {}) => {
  if (!isEnabled()) {
    throw new Error('AI service is not configured');
  }

  const client = getClient();
  const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
  const maxTokens = options.maxTokens || 500;
  const temperature = options.temperature || 0.2;

  const response = await client.chat.completions.create({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0
  });

  return response.choices[0]?.message?.content || '';
};

const getCodeSuggestions = async ({ code, language, cursorPosition, prefix = '', suffix = '' }) => {
  if (!isEnabled()) {
    return {
      enabled: false,
      suggestions: []
    };
  }

  const systemPrompt = `You are an expert code completion assistant for ${language}.
Provide helpful, context-aware code completions.
Only return the completion text, no explanations.
Keep suggestions concise and relevant.

Respond with a JSON object containing:
{
  "suggestions": [
    { "text": "completion1", "type": "function" },
    { "text": "completion2", "type": "variable" }
  ]
}`;

  const contextPrompt = `Current file language: ${language}

Code context:
${prefix}${cursorPosition ? '[CURSOR]' : ''}${suffix}

Complete the code at the cursor position.`;

  try {
    const result = await getCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextPrompt }
    ], { maxTokens: 200, temperature: 0.3 });

    const parsed = JSON.parse(result);
    return {
      enabled: true,
      suggestions: parsed.suggestions || []
    };
  } catch (error) {
    console.error('AI suggestion error:', error);
    return {
      enabled: true,
      suggestions: []
    };
  }
};

const explainCode = async ({ code, language, selectedCode = '' }) => {
  if (!isEnabled()) {
    throw new Error('AI service is not configured');
  }

  const targetCode = selectedCode || code;

  const systemPrompt = `You are an expert code explainer.
Explain the code clearly and concisely.
Break down complex parts.
Highlight important functions, variables, and logic flow.
Use markdown formatting for readability.

Respond in the following structure:
## Overview
[high-level summary]

## Key Components
- **[item1]**: [description]
- **[item2]**: [description]

## Logic Flow
[step-by-step explanation]`;

  const userPrompt = `Language: ${language}

Code to explain:
\`\`\`${language}
${targetCode}
\`\`\`

Please explain this code.`;

  try {
    const explanation = await getCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { maxTokens: 1000, temperature: 0.3 });

    return {
      code: targetCode,
      language,
      explanation,
      hasSelection: !!selectedCode
    };
  } catch (error) {
    console.error('AI explain error:', error);
    throw error;
  }
};

const detectBugs = async ({ code, language }) => {
  if (!isEnabled()) {
    throw new Error('AI service is not configured');
  }

  const systemPrompt = `You are an expert bug detector.
Analyze the code for potential bugs, issues, and code smells.
Be thorough but not overly verbose.
For each issue, suggest a fix.

Respond with a JSON object:
{
  "issues": [
    {
      "severity": "critical|warning|info",
      "lineNumber": 5,
      "description": "Issue description",
      "suggestion": "How to fix",
      "codeSnippet": "relevant code"
    }
  ],
  "summary": "Overall assessment"
}`;

  const userPrompt = `Language: ${language}

Code to analyze:
\`\`\`${language}
${code}
\`\`\`

Please analyze this code for bugs and issues.`;

  try {
    const result = await getCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { maxTokens: 800, temperature: 0.2 });

    const parsed = JSON.parse(result);
    return {
      code,
      language,
      issues: parsed.issues || [],
      summary: parsed.summary || 'Analysis complete',
      totalIssues: (parsed.issues || []).length,
      criticalCount: (parsed.issues || []).filter(i => i.severity === 'critical').length,
      warningCount: (parsed.issues || []).filter(i => i.severity === 'warning').length
    };
  } catch (error) {
    console.error('AI bug detection error:', error);
    return {
      code,
      language,
      issues: [],
      summary: 'Failed to analyze code',
      error: error.message,
      totalIssues: 0,
      criticalCount: 0,
      warningCount: 0
    };
  }
};

const refactorSuggestions = async ({ code, language }) => {
  if (!isEnabled()) {
    throw new Error('AI service is not configured');
  }

  const systemPrompt = `You are an expert code refactoring assistant.
Suggest improvements for code quality, readability, performance, and best practices.

Respond with a JSON object:
{
  "suggestions": [
    {
      "type": "performance|readability|best_practice",
      "title": "Short title",
      "description": "Detailed explanation",
      "before": "current code",
      "after": "improved code"
    }
  ]
}`;

  const userPrompt = `Language: ${language}

Code to refactor:
\`\`\`${language}
${code}
\`\`\`

Suggest refactoring improvements.`;

  try {
    const result = await getCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { maxTokens: 1000, temperature: 0.3 });

    const parsed = JSON.parse(result);
    return {
      code,
      language,
      suggestions: parsed.suggestions || []
    };
  } catch (error) {
    console.error('AI refactor error:', error);
    return {
      code,
      language,
      suggestions: []
    };
  }
};

module.exports = {
  isEnabled,
  getCodeSuggestions,
  explainCode,
  detectBugs,
  refactorSuggestions,
  getCompletion
};
