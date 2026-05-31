import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { observer } from 'mobx-react-lite';
import {
  Layout,
  Card,
  Button,
  Typography,
  Space,
  message,
  Drawer,
  Form,
  Input,
  Select,
  InputNumber,
  ColorPicker,
  Tabs,
  Tree,
  Tag,
} from 'antd';
import {
  SaveOutlined,
  UndoOutlined,
  RedoOutlined,
  EyeOutlined,
  DeleteOutlined,
  CopyOutlined,
  ColumnHeightOutlined,
  FormOutlined,
  BarChartOutlined,
  TableOutlined,
  ContainerOutlined,
} from '@ant-design/icons';
import { useDrag, useDrop } from 'react-dnd';
import LayoutComponent from '@/components/Layout';
import { api } from '@/services/api';
import { canvasStore } from '@/stores/canvas.store';
import { PageComponent, ComponentType } from '@lowcode/shared';

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

interface DragItem {
  type: ComponentType;
  isNew?: boolean;
}

const COMPONENT_TYPES: { type: ComponentType; icon: React.ReactNode; label: string }[] = [
  { type: 'Input', icon: <FormOutlined />, label: 'Input' },
  { type: 'Select', icon: <FormOutlined />, label: 'Select' },
  { type: 'Button', icon: <FormOutlined />, label: 'Button' },
  { type: 'Text', icon: <FormOutlined />, label: 'Text' },
  { type: 'Image', icon: <FormOutlined />, label: 'Image' },
  { type: 'Table', icon: <TableOutlined />, label: 'Table' },
  { type: 'Chart', icon: <BarChartOutlined />, label: 'Chart' },
  { type: 'Container', icon: <ContainerOutlined />, label: 'Container' },
  { type: 'Row', icon: <ColumnHeightOutlined />, label: 'Row' },
  { type: 'Col', icon: <ColumnHeightOutlined />, label: 'Column' },
];

function DraggableComponent({ component, index, parentId }: { component: PageComponent; index: number; parentId?: string }) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'component',
    item: { id: component.id, index, parentId },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }));

  const [{ isOver, canDrop }, drop] = useDrop(() => ({
    accept: ['component', 'componentType'],
    drop: (item: DragItem | { id: string; index: number; parentId?: string }) => {
      if ('type' in item && item.isNew) {
        canvasStore.addComponent(item.type as ComponentType, component.id);
      } else if ('id' in item) {
        canvasStore.moveComponent(item.id, component.id, 0);
      }
    },
    canDrop: (item) => {
      return component.type === 'Container' || component.type === 'Row' || component.type === 'Col';
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }));

  const ref = (node: HTMLDivElement | null) => {
    drag(node);
    if (component.type === 'Container' || component.type === 'Row' || component.type === 'Col') {
      drop(node);
    }
  };

  const isSelected = canvasStore.selectedComponentId === component.id;

  return (
    <div
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        canvasStore.selectComponent(component.id);
      }}
      style={{
        opacity: isDragging ? 0.5 : 1,
        border: isSelected ? '2px solid #1890ff' : isOver && canDrop ? '2px dashed #1890ff' : '1px solid #f0f0f0',
        borderRadius: 4,
        padding: 8,
        margin: 4,
        background: isSelected ? '#e6f7ff' : 'white',
        cursor: 'move',
        minHeight: 40,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Tag color="blue" style={{ margin: 0 }}>{component.type}</Tag>
        <span style={{ fontSize: 12, color: '#999' }}>{component.id.slice(0, 8)}</span>
      </div>
      {component.children && component.children.length > 0 && (
        <div style={{ marginLeft: 8, borderLeft: '2px solid #f0f0f0', paddingLeft: 8 }}>
          {component.children.map((child, idx) => (
            <DraggableComponent
              key={child.id}
              component={child}
              index={idx}
              parentId={component.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ComponentPalette() {
  return (
    <Card title="Components" size="small" style={{ marginBottom: 16 }}>
      <Space wrap>
        {COMPONENT_TYPES.map(({ type, icon, label }) => {
          const [{ isDragging }, drag] = useDrag(() => ({
            type: 'componentType',
            item: { type, isNew: true },
            collect: (monitor) => ({
              isDragging: monitor.isDragging(),
            }),
          }));

          return (
            <div
              key={type}
              ref={drag}
              style={{
                opacity: isDragging ? 0.5 : 1,
                padding: '8px 12px',
                border: '1px solid #d9d9d9',
                borderRadius: 4,
                cursor: 'move',
                background: 'white',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {icon}
              {label}
            </div>
          );
        })}
      </Space>
    </Card>
  );
}

function ComponentTree() {
  const page = canvasStore.currentPage;
  if (!page) return null;

  const buildTreeData = (components: PageComponent[]): any[] => {
    return components.map((c) => ({
      key: c.id,
      title: `${c.type} (${c.id.slice(0, 6)})`,
      children: c.children?.length ? buildTreeData(c.children) : undefined,
    }));
  };

  return (
    <Card title="Component Tree" size="small">
      <Tree
        showLine
        selectedKeys={canvasStore.selectedComponentId ? [canvasStore.selectedComponentId] : []}
        onSelect={(keys) => {
          if (keys.length > 0) {
            canvasStore.selectComponent(keys[0] as string);
          }
        }}
        treeData={buildTreeData(page.components)}
      />
    </Card>
  );
}

function PropertyPanel({ onClose }: { onClose: () => void }) {
  const selected = canvasStore.selectedComponent;
  const [form] = Form.useForm();

  useEffect(() => {
    if (selected) {
      form.setFieldsValue({
        id: selected.id,
        type: selected.type,
        props: selected.props || {},
        style: selected.style || {},
      });
    }
  }, [selected, form]);

  if (!selected) {
    return <div style={{ padding: 16, textAlign: 'center', color: '#999' }}>Select a component</div>;
  }

  const handleValuesChange = (changedValues: any, allValues: any) => {
    if (changedValues.props) {
      canvasStore.updateComponent(selected.id, { props: allValues.props });
    }
    if (changedValues.style) {
      canvasStore.updateComponent(selected.id, { style: allValues.style });
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <Title level={5} style={{ margin: '0 0 16px 0' }}>Properties</Title>
      <Form
        form={form}
        layout="vertical"
        onValuesChange={handleValuesChange}
      >
        <Form.Item label="ID">
          <Input value={selected.id} disabled />
        </Form.Item>
        <Form.Item label="Type">
          <Input value={selected.type} disabled />
        </Form.Item>

        <Tabs
          items={[
            {
              key: 'props',
              label: 'Props',
              children: (
                <div>
                  <Form.Item name={['props', 'text']} label="Text">
                    <Input />
                  </Form.Item>
                  <Form.Item name={['props', 'placeholder']} label="Placeholder">
                    <Input />
                  </Form.Item>
                  <Form.Item name={['props', 'width']} label="Width">
                    <InputNumber style={{ width: '100%' }} placeholder="e.g., 200" />
                  </Form.Item>
                  <Form.Item name={['props', 'disabled']} label="Disabled" valuePropName="checked">
                    <Select
                      options={[
                        { value: true, label: 'True' },
                        { value: false, label: 'False' },
                      ]}
                    />
                  </Form.Item>
                </div>
              ),
            },
            {
              key: 'style',
              label: 'Style',
              children: (
                <div>
                  <Form.Item name={['style', 'margin']} label="Margin">
                    <Input placeholder="e.g., 8px" />
                  </Form.Item>
                  <Form.Item name={['style', 'padding']} label="Padding">
                    <Input placeholder="e.g., 8px" />
                  </Form.Item>
                  <Form.Item name={['style', 'width']} label="Width">
                    <Input placeholder="e.g., 100%" />
                  </Form.Item>
                  <Form.Item name={['style', 'height']} label="Height">
                    <Input placeholder="e.g., auto" />
                  </Form.Item>
                  <Form.Item name={['style', 'backgroundColor']} label="Background Color">
                    <ColorPicker />
                  </Form.Item>
                </div>
              ),
            },
            {
              key: 'data',
              label: 'Data',
              children: (
                <div>
                  <Form.Item name={['dataSource', 'type']} label="Data Source">
                    <Select
                      placeholder="Select data source"
                      options={[
                        { value: 'static', label: 'Static' },
                        { value: 'api', label: 'API' },
                        { value: 'workflow', label: 'Workflow' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name={['dataSource', 'url']} label="API URL">
                    <Input placeholder="https://api.example.com/data" />
                  </Form.Item>
                </div>
              ),
            },
          ]}
        />

        <Space style={{ marginTop: 16, width: '100%' }}>
          <Button
            icon={<CopyOutlined />}
            onClick={() => {
              canvasStore.copyComponent(selected.id);
              message.success('Component copied');
            }}
          >
            Copy
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              canvasStore.removeComponent(selected.id);
              message.success('Component removed');
            }}
          >
            Delete
          </Button>
        </Space>
      </Form>
    </div>
  );
}

function PageDesigner() {
  const router = useRouter();
  const { appId, pageId } = router.query;
  const [loading, setLoading] = useState(false);
  const [propertyOpen, setPropertyOpen] = useState(true);

  const loadPage = async () => {
    if (!pageId) return;
    setLoading(true);
    try {
      const response = await api.pages.get(pageId as string);
      canvasStore.setCurrentPage(response.data);
    } catch (error) {
      message.error('Failed to load page');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPage();
    return () => {
      canvasStore.setCurrentPage(null);
    };
  }, [pageId]);

  const handleSave = async () => {
    if (!pageId || !canvasStore.currentPage) return;
    setLoading(true);
    try {
      await api.pages.update(pageId as string, {
        name: canvasStore.currentPage.name,
        path: canvasStore.currentPage.path,
        components: canvasStore.currentPage.components,
      });
      message.success('Page saved');
    } catch (error) {
      message.error('Failed to save page');
    } finally {
      setLoading(false);
    }
  };

  const [{ isOver, canDrop }, drop] = useDrop(() => ({
    accept: ['componentType'],
    drop: (item: DragItem) => {
      if (item.isNew) {
        canvasStore.addComponent(item.type as ComponentType);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }));

  const page = canvasStore.currentPage;

  return (
    <LayoutComponent appId={appId as string}>
      <Layout style={{ height: 'calc(100vh - 144px)' }}>
        <Header
          style={{
            background: 'white',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            height: 56,
            lineHeight: '56px',
          }}
        >
          <Space>
            <Title level={4} style={{ margin: 0 }}>{page?.name}</Title>
          </Space>
          <Space>
            <Button
              icon={<UndoOutlined />}
              onClick={() => canvasStore.undo()}
              disabled={!canvasStore.canUndo}
            >
              Undo
            </Button>
            <Button
              icon={<RedoOutlined />}
              onClick={() => canvasStore.redo()}
              disabled={!canvasStore.canRedo}
            >
              Redo
            </Button>
            <Button icon={<EyeOutlined />}>Preview</Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={loading}
            >
              Save
            </Button>
          </Space>
        </Header>

        <Layout>
          <Sider
            width={280}
            theme="light"
            style={{ background: '#fafafa', padding: 16, overflow: 'auto' }}
          >
            <ComponentPalette />
            <ComponentTree />
          </Sider>

          <Content
            ref={drop}
            style={{
              background: isOver && canDrop ? '#e6f7ff' : '#f5f5f5',
              padding: 24,
              overflow: 'auto',
              border: isOver && canDrop ? '2px dashed #1890ff' : 'none',
            }}
          >
            {loading ? (
              <div style={{ textAlign: 'center', padding: 100 }}>Loading...</div>
            ) : !page ? (
              <div style={{ textAlign: 'center', padding: 100, color: '#999' }}>
                Drag components here
              </div>
            ) : (
              <Card style={{ minHeight: '100%' }}>
                {page.components.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 100, color: '#999' }}>
                    Drag and drop components to start designing
                  </div>
                ) : (
                  page.components.map((component, idx) => (
                    <DraggableComponent
                      key={component.id}
                      component={component}
                      index={idx}
                    />
                  ))
                )}
              </Card>
            )}
          </Content>

          <Drawer
            title="Properties"
            placement="right"
            onClose={() => setPropertyOpen(false)}
            open={propertyOpen}
            width={360}
          >
            <PropertyPanel onClose={() => setPropertyOpen(false)} />
          </Drawer>
        </Layout>
      </Layout>
    </LayoutComponent>
  );
}

export default observer(PageDesigner);
