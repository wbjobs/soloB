export type ComponentType =
  | 'Container'
  | 'Row'
  | 'Col'
  | 'Form'
  | 'Input'
  | 'Select'
  | 'Checkbox'
  | 'Radio'
  | 'DatePicker'
  | 'Button'
  | 'Table'
  | 'Pagination'
  | 'Card'
  | 'Tabs'
  | 'Chart'
  | 'Image'
  | 'Text'
  | 'Divider'
  | 'Modal';

export interface ComponentStyle {
  width?: string;
  height?: string;
  margin?: string;
  padding?: string;
  backgroundColor?: string;
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
  border?: string;
  borderRadius?: string;
  display?: string;
  flex?: string;
  justifyContent?: string;
  alignItems?: string;
}

export interface DataSourceConfig {
  type: 'api' | 'workflow' | 'static';
  endpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  workflowId?: string;
  staticData?: any;
  mapping?: Record<string, string>;
}

export interface EventHandler {
  event: 'onClick' | 'onChange' | 'onSubmit' | 'onLoad' | 'onClose';
  action: 'navigate' | 'callApi' | 'showModal' | 'closeModal' | 'setState' | 'triggerWorkflow';
  config: Record<string, any>;
}

export interface PageComponent {
  id: string;
  type: ComponentType;
  parentId?: string;
  children: PageComponent[];
  props: Record<string, any>;
  style: ComponentStyle;
  dataSource?: DataSourceConfig;
  events: EventHandler[];
}

export interface PageSchema {
  id: string;
  applicationId: string;
  name: string;
  path: string;
  title?: string;
  description?: string;
  components: PageComponent[];
  stateVariables: Record<string, any>;
  isLayout: boolean;
  layoutId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CanvasHistory {
  schema: PageSchema;
  timestamp: number;
}

export interface CanvasState {
  currentSchema: PageSchema;
  history: CanvasHistory[];
  historyIndex: number;
  selectedComponentId?: string;
  draggedComponentId?: string;
}
