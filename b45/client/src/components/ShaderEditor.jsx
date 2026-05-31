import React, { useRef, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';

const GLSL_KEYWORDS = [
  'void', 'float', 'int', 'uint', 'bool', 'double',
  'vec2', 'vec3', 'vec4',
  'ivec2', 'ivec3', 'ivec4',
  'uvec2', 'uvec3', 'uvec4',
  'bvec2', 'bvec3', 'bvec4',
  'dvec2', 'dvec3', 'dvec4',
  'mat2', 'mat3', 'mat4',
  'mat2x2', 'mat2x3', 'mat2x4',
  'mat3x2', 'mat3x3', 'mat3x4',
  'mat4x2', 'mat4x3', 'mat4x4',
  'dmat2', 'dmat3', 'dmat4',
  'dmat2x2', 'dmat2x3', 'dmat2x4',
  'dmat3x2', 'dmat3x3', 'dmat3x4',
  'dmat4x2', 'dmat4x3', 'dmat4x4',
  'sampler1D', 'sampler2D', 'sampler3D', 'samplerCube',
  'sampler1DShadow', 'sampler2DShadow', 'samplerCubeShadow',
  'sampler1DArray', 'sampler2DArray',
  'sampler1DArrayShadow', 'sampler2DArrayShadow',
  'sampler2DMS', 'sampler2DMSArray',
  'samplerCubeArray', 'samplerCubeArrayShadow',
  'samplerBuffer', 'sampler2DRect', 'sampler2DRectShadow',
  'isampler1D', 'isampler2D', 'isampler3D', 'isamplerCube',
  'isampler1DArray', 'isampler2DArray',
  'isampler2DMS', 'isampler2DMSArray',
  'isamplerCubeArray', 'isamplerBuffer', 'isampler2DRect',
  'usampler1D', 'usampler2D', 'usampler3D', 'usamplerCube',
  'usampler1DArray', 'usampler2DArray',
  'usampler2DMS', 'usampler2DMSArray',
  'usamplerCubeArray', 'usamplerBuffer', 'usampler2DRect',
  'image1D', 'image2D', 'image3D', 'imageCube',
  'image1DArray', 'image2DArray', 'imageCubeArray',
  'imageBuffer', 'image2DRect', 'image2DMS', 'image2DMSArray',
  'iimage1D', 'iimage2D', 'iimage3D', 'iimageCube',
  'iimage1DArray', 'iimage2DArray', 'iimageCubeArray',
  'iimageBuffer', 'iimage2DRect', 'iimage2DMS', 'iimage2DMSArray',
  'uimage1D', 'uimage2D', 'uimage3D', 'uimageCube',
  'uimage1DArray', 'uimage2DArray', 'uimageCubeArray',
  'uimageBuffer', 'uimage2DRect', 'uimage2DMS', 'uimage2DMSArray',
  'atomic_uint', 'struct', 'class', 'union', 'enum',
];

const GLSL_STORAGE = [
  'const', 'uniform', 'attribute', 'varying',
  'in', 'out', 'inout',
  'buffer', 'shared', 'static', 'extern', 'external',
  'centroid', 'flat', 'smooth', 'noperspective',
  'patch', 'sample',
  'invariant', 'precise',
  'row_major', 'column_major',
];

const GLSL_LAYOUT = [
  'layout', 'location', 'binding', 'index', 'set',
  'std140', 'std430', 'packed', 'shared',
  'triangles', 'points', 'lines', 'lines_adjacency',
  'triangles_adjacency', 'triangle_strip', 'line_strip',
  'invocations', 'vertices', 'local_size_x', 'local_size_y', 'local_size_z',
  'origin_upper_left', 'pixel_center_integer',
  'depth_any', 'depth_greater', 'depth_less', 'depth_unchanged',
];

const GLSL_QUALIFIERS = [
  'highp', 'mediump', 'lowp',
  'precision',
  'coherent', 'volatile', 'restrict', 'readonly', 'writeonly',
  'early_fragment_tests', 'post_depth_coverage',
  'blend_support_all_equations',
];

const GLSL_CONTROL_FLOW = [
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'discard',
];

const GLSL_BUILTIN_VARIABLES = [
  'gl_VertexID', 'gl_InstanceID', 'gl_InstanceIndex',
  'gl_DrawID', 'gl_BaseVertex', 'gl_BaseInstance',
  'gl_Position', 'gl_PointSize', 'gl_ClipDistance', 'gl_CullDistance',
  'gl_PrimitiveID', 'gl_Layer', 'gl_ViewportIndex',
  'gl_FragCoord', 'gl_FrontFacing', 'gl_PointCoord',
  'gl_FragColor', 'gl_FragData', 'gl_FragDepth', 'gl_SampleMaskIn',
  'gl_SampleID', 'gl_SamplePosition', 'gl_SampleMask',
  'gl_ClipVertex', 'gl_FrontColor', 'gl_BackColor',
  'gl_FrontSecondaryColor', 'gl_BackSecondaryColor',
  'gl_TexCoord', 'gl_FogFragCoord',
  'gl_GlobalInvocationID', 'gl_LocalInvocationID',
  'gl_WorkGroupID', 'gl_NumWorkGroups',
  'gl_LocalInvocationIndex', 'gl_WorkGroupSize',
  'gl_NumSamples', 'gl_HelperInvocation',
  'gl_Color', 'gl_SecondaryColor', 'gl_Normal',
  'gl_Vertex', 'gl_MultiTexCoord0', 'gl_MultiTexCoord1',
  'gl_MultiTexCoord2', 'gl_MultiTexCoord3',
  'gl_FogCoord', 'gl_EdgeFlag',
];

const GLSL_CONSTANTS = [
  'true', 'false', 'null',
];

const GLSL_BUILTIN_FUNCTIONS = [
  'radians', 'degrees', 'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh',
  'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
  'abs', 'sign', 'floor', 'trunc', 'round', 'roundEven', 'ceil', 'fract',
  'mod', 'modf', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep',
  'isnan', 'isinf', 'floatBitsToInt', 'floatBitsToUint',
  'intBitsToFloat', 'uintBitsToFloat', 'packUnorm2x16', 'packSnorm2x16',
  'packUnorm4x8', 'packSnorm4x8',
  'unpackUnorm2x16', 'unpackSnorm2x16', 'unpackUnorm4x8', 'unpackSnorm4x8',
  'length', 'distance', 'dot', 'cross', 'normalize', 'faceforward',
  'reflect', 'refract',
  'matrixCompMult', 'outerProduct', 'transpose', 'determinant', 'inverse',
  'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual',
  'equal', 'notEqual', 'any', 'all', 'not',
  'textureSize', 'textureQueryLod', 'textureQueryLevels', 'textureSamples',
  'texture', 'textureProj', 'textureLod', 'textureOffset',
  'textureFetch', 'textureFetchOffset', 'textureProjOffset',
  'textureLodOffset', 'textureProjLod', 'textureProjLodOffset',
  'textureGrad', 'textureGradOffset', 'textureProjGrad', 'textureProjGradOffset',
  'textureGather', 'textureGatherOffset', 'textureGatherOffsets',
  'texelFetch', 'texelFetchOffset', 'texture2D', 'texture3D', 'textureCube',
  'shadow2D', 'shadowCube',
  'dFdx', 'dFdy', 'fwidth',
  'interpolateAtCentroid', 'interpolateAtSample', 'interpolateAtOffset',
  'noise1', 'noise2', 'noise3', 'noise4',
  'EmitVertex', 'EndPrimitive', 'EmitStreamVertex', 'EndStreamPrimitive',
  'barrier', 'memoryBarrier',
  'groupMemoryBarrier', 'atomicCounterIncrement',
  'atomicCounterDecrement', 'atomicCounter',
  'imageLoad', 'imageStore', 'imageAtomicAdd', 'imageAtomicMin',
  'imageAtomicMax', 'imageAtomicAnd', 'imageAtomicOr', 'imageAtomicXor',
  'imageAtomicExchange', 'imageAtomicCompSwap',
  'atomicAdd', 'atomicMin', 'atomicMax', 'atomicAnd', 'atomicOr',
  'atomicXor', 'atomicExchange', 'atomicCompSwap',
  'packHalf2x16', 'unpackHalf2x16',
  'frexp', 'ldexp',
  'uaddCarry', 'usubBorrow', 'imulExtended', 'uimulExtended',
  'bitfieldExtract', 'bitfieldInsert', 'bitfieldReverse', 'bitCount',
  'findLSB', 'findMSB',
  'fma',
];

const SHADERTOY_UNIFORMS = [
  'iTime', 'iTimeDelta', 'iFrame', 'iFrameRate',
  'iResolution', 'iMouse', 'iChannelTime', 'iChannel',
  'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3',
  'iChannelResolution', 'iDate', 'iSampleRate',
  'iGlobalTime', 'iGlobalFrame',
  'mainImage',
];

function ShaderEditor({ code, onCodeChange, isRemoteChangeRef, errors = [] }) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const lastCodeRef = useRef('');
  const isUpdatingRef = useRef(false);
  const markersRef = useRef([]);
  const modelRef = useRef(null);

  const updateErrorMarkers = useCallback((monaco, model, errorList) => {
    if (!monaco || !model) return;

    const newMarkers = errorList.map((err) => {
      const line = Math.max(1, err.line);
      const column = Math.max(1, err.column || 1);
      
      return {
        severity: monaco.MarkerSeverity.Error,
        startLineNumber: line,
        startColumn: column,
        endLineNumber: line,
        endColumn: column + 50,
        message: err.message || err.raw || 'Shader compilation error',
        source: 'glsl-compiler',
      };
    });

    monaco.editor.setModelMarkers(model, 'glsl-compiler', newMarkers);
    markersRef.current = newMarkers;
  }, []);

  const handleEditorDidMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    lastCodeRef.current = code;

    if (!monaco.languages.getLanguages().some(lang => lang.id === 'glsl')) {
      monaco.languages.register({ id: 'glsl' });
    }

    monaco.languages.setMonarchTokensProvider('glsl', {
      defaultToken: 'invalid',
      tokenPostfix: '.glsl',
      keywords: GLSL_KEYWORDS,
      storage: GLSL_STORAGE,
      layout: GLSL_LAYOUT,
      qualifiers: GLSL_QUALIFIERS,
      controlFlow: GLSL_CONTROL_FLOW,
      builtinVariables: GLSL_BUILTIN_VARIABLES,
      constants: GLSL_CONSTANTS,
      functions: GLSL_BUILTIN_FUNCTIONS,
      shadertoy: SHADERTOY_UNIFORMS,
      brackets: [
        ['{', '}', 'delimiter.curly'],
        ['[', ']', 'delimiter.square'],
        ['(', ')', 'delimiter.parenthesis'],
        ['<', '>', 'delimiter.angle'],
      ],
      operators: [
        '=', '>', '<', '!', '~', '?', ':',
        '==', '<=', '>=', '!=', '&&', '||', '++', '--',
        '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '>>>',
        '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '>>>=',
      ],
      symbols:  /[=><!~?:&|+\-*\/\^%]+/,
      escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
      tokenizer: {
        root: [
          [/#\s*[a-zA-Z_][\w]*/, { token: 'keyword.directive', next: '@directive' }],
          
          [/[a-zA-Z_][\w]*/, {
            cases: {
              '@storage': 'storage.type',
              '@layout': 'keyword.layout',
              '@qualifiers': 'storage.modifier',
              '@keywords': 'keyword',
              '@controlFlow': 'keyword.control',
              '@builtinVariables': 'variable.other.builtin',
              '@constants': 'constant.language',
              '@functions': 'support.function',
              '@shadertoy': 'variable.parameter',
              '@default': 'identifier',
            },
          }],
          
          [/\/\/.*$/, 'comment.line'],
          [/\/\*/, 'comment', '@comment'],
          
          [/\d+\.\d*[eE][-+]?\d*[fF]*/, 'number.float'],
          [/\d*\.?\d+[eE][-+]?\d*[fF]*/, 'number.float'],
          [/\d+\.\d*[fF]/, 'number.float'],
          [/\d*\.?\d+[fF]/, 'number.float'],
          [/\d+\.\d*/, 'number.float'],
          [/\d*\.?\d+/, 'number.float'],
          [/0[xX][0-9a-fA-F]+[uU]?/, 'number.hex'],
          [/\d+[uU]/, 'number'],
          [/\d+/, 'number'],
          
          [/[{}()\[\]]/, '@brackets'],
          
          [/[;,.]/, 'delimiter'],
          
          [/[<>=!%&+\-*/|~^?:]/, {
            cases: {
              '@operators': 'operator',
              '@default': 'operator',
            },
          }],
          
          [/"([^"\\]|\\.)*$/, 'string.invalid'],
          [/"/, 'string', '@string'],
        ],
        
        directive: [
          [/(define|undef|ifdef|ifndef|if|else|elif|endif|error|pragma|line|version|extension)\b/, 'keyword.directive', '@pop'],
          [/.*/, 'string', '@pop'],
        ],
        
        comment: [
          [/[^\/*]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[\/*]/, 'comment'],
        ],
        
        string: [
          [/[^\\"]+/, 'string'],
          [/\\./, 'string.escape.invalid'],
          [/"/, 'string', '@pop'],
        ],
      },
    });

    monaco.languages.setLanguageConfiguration('glsl', {
      comments: {
        lineComment: '//',
        blockComment: ['/*', '*/'],
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });

    monaco.languages.registerHoverProvider('glsl', {
      provideHover: function(model, position) {
        const markers = monaco.editor.getModelMarkers({
          resource: model.uri,
        });

        const line = position.lineNumber;
        const column = position.column;

        for (const marker of markers) {
          if (marker.startLineNumber === line && 
              column >= marker.startColumn && 
              column <= marker.endColumn) {
            return {
              range: new monaco.Range(
                marker.startLineNumber,
                marker.startColumn,
                marker.endLineNumber,
                marker.endColumn
              ),
              contents: [
                {
                  value: `**GLSL Compilation Error**`
                },
                {
                  value: '---'
                },
                {
                  value: marker.message
                }
              ]
            };
          }
        }

        return null;
      }
    });

    monaco.editor.defineTheme('shaderTheme', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.directive', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.control', foreground: 'c586c0', fontStyle: 'bold' },
        { token: 'keyword.layout', foreground: '9cdcfe' },
        { token: 'storage.type', foreground: '4ec9b0', fontStyle: 'bold' },
        { token: 'storage.modifier', foreground: 'dcdcaa' },
        { token: 'support.function', foreground: 'dcdcaa' },
        { token: 'variable.other.builtin', foreground: '4fc1ff' },
        { token: 'variable.parameter', foreground: 'ce9178' },
        { token: 'constant.language', foreground: '569cd6' },
        { token: 'number', foreground: 'b5cea8' },
        { token: 'number.float', foreground: 'b5cea8' },
        { token: 'number.hex', foreground: 'b5cea8' },
        { token: 'string', foreground: 'ce9178' },
        { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
        { token: 'comment.line', foreground: '6a9955', fontStyle: 'italic' },
        { token: 'identifier', foreground: '9cdcfe' },
        { token: 'delimiter', foreground: 'd4d4d4' },
        { token: 'operator', foreground: 'd4d4d4' },
        { token: 'delimiter.curly', foreground: 'ffd700' },
        { token: 'delimiter.square', foreground: 'ffd700' },
        { token: 'delimiter.parenthesis', foreground: 'ffd700' },
        { token: 'invalid', foreground: 'f44747' },
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#ffffff',
        'editorCursor.foreground': '#aeafad',
        'editor.selectionBackground': '#264f78',
        'editor.selectionHighlightBackground': '#3a3d41',
        'editor.wordHighlightBackground': '#4a4e53',
        'editor.wordHighlightStrongBackground': '#4a4e53',
        'editor.findMatchBackground': '#515c6a',
        'editor.findMatchHighlightBackground': '#555555',
        'editorError.foreground': '#f44747',
        'editorError.border': '#f44747',
        'editorWarning.foreground': '#cca700',
        'editorOverviewRuler.errorForeground': '#f44747',
        'editorOverviewRuler.warningForeground': '#cca700',
      },
    });

    monaco.editor.setTheme('shaderTheme');

    const model = editor.getModel();
    modelRef.current = model;

    if (errors && errors.length > 0) {
      updateErrorMarkers(monaco, model, errors);
    }
  }, [code, errors, updateErrorMarkers]);

  useEffect(() => {
    if (monacoRef.current && modelRef.current) {
      updateErrorMarkers(monacoRef.current, modelRef.current, errors);
    }
  }, [errors, updateErrorMarkers]);

  useEffect(() => {
    if (!editorRef.current) return;
    
    const model = editorRef.current.getModel();
    if (!model) return;
    
    const currentModelValue = model.getValue();
    
    if (code !== currentModelValue) {
      isUpdatingRef.current = true;
      
      const selection = editorRef.current.getSelection();
      
      model.setValue(code);
      
      if (selection) {
        editorRef.current.setSelection(selection);
      }
      
      lastCodeRef.current = code;
      
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    }
  }, [code, isRemoteChangeRef]);

  const handleChange = useCallback((value) => {
    if (isUpdatingRef.current) {
      return;
    }
    
    if (onCodeChange && value !== undefined && value !== lastCodeRef.current) {
      lastCodeRef.current = value;
      onCodeChange(value);
    }
  }, [onCodeChange]);

  const handleBeforeMount = useCallback((monaco) => {
    if (!monaco.languages.getLanguages().some(lang => lang.id === 'glsl')) {
      monaco.languages.register({ id: 'glsl' });
    }
  }, []);

  return (
    <div className="editor-container">
      <Editor
        height="100%"
        language="glsl"
        theme="shaderTheme"
        defaultValue={code}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        beforeMount={handleBeforeMount}
        options={{
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
          tabSize: 4,
          insertSpaces: true,
          fontFamily: "'Consolas', 'Courier New', monospace",
          renderLineHighlight: 'line',
          cursorBlinking: 'smooth',
          smoothScrolling: true,
          padding: { top: 10 },
          readOnly: false,
          renderWhitespace: 'none',
          scrollbar: {
            useShadows: false,
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          folding: true,
          foldingStrategy: 'indentation',
          showFoldingControls: 'always',
          bracketPairColorization: {
            enabled: true,
          },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          renderControlCharacter: '·',
          minimap: {
            enabled: true,
            renderCharacters: true,
            scale: 1,
          },
          suggestOnTriggerCharacters: true,
          quickSuggestions: {
            comments: 'on',
            strings: 'on',
            other: 'on',
          },
          parameterHints: {
            enabled: true,
            cycle: false,
          },
          hover: {
            enabled: true,
            delay: 100,
            sticky: true,
          },
        }}
      />
    </div>
  );
}

export default ShaderEditor;
