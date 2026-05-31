import json
import threading
import queue
from datetime import datetime
from collections import defaultdict, deque

import dash
from dash import dcc, html, Input, Output
import plotly.graph_objs as go
from kafka import KafkaConsumer

KAFKA_BROKER = 'localhost:9092'
ANOMALY_TOPIC = 'price-anomalies'

MAX_POINTS_PER_STOCK = 100
UPDATE_INTERVAL_MS = 1000

anomaly_queue = queue.Queue()

stock_data = defaultdict(lambda: {
    'timestamps': deque(maxlen=MAX_POINTS_PER_STOCK),
    'prices': deque(maxlen=MAX_POINTS_PER_STOCK),
    'moving_averages': deque(maxlen=MAX_POINTS_PER_STOCK),
    'anomaly_indices': deque(maxlen=MAX_POINTS_PER_STOCK)
})

def kafka_consumer_thread():
    consumer = KafkaConsumer(
        ANOMALY_TOPIC,
        bootstrap_servers=KAFKA_BROKER,
        auto_offset_reset='latest',
        enable_auto_commit=True,
        group_id='dashboard-consumer',
        value_deserializer=lambda m: json.loads(m.decode('utf-8')),
    )
    
    print(f"Kafka 消费者线程已启动，订阅主题: {ANOMALY_TOPIC}")
    
    try:
        for message in consumer:
            data = message.value
            anomaly_queue.put(data)
    except Exception as e:
        print(f"Kafka 消费者错误: {e}")
    finally:
        consumer.close()

def process_anomaly_data(data):
    symbol = data.get('symbol')
    if not symbol:
        return
    
    try:
        timestamp_str = data.get('original_timestamp') or data.get('detection_time')
        dt = datetime.fromisoformat(timestamp_str)
        display_time = dt.strftime('%H:%M:%S')
    except:
        display_time = datetime.now().strftime('%H:%M:%S')
    
    price = data.get('current_price', 0)
    moving_avg = data.get('moving_average', 0)
    
    stock_info = stock_data[symbol]
    stock_info['timestamps'].append(display_time)
    stock_info['prices'].append(price)
    stock_info['moving_averages'].append(moving_avg)
    stock_info['anomaly_indices'].append(len(stock_info['timestamps']) - 1)

app = dash.Dash(__name__)
app.title = "股票价格异常检测 - 实时仪表盘"

app.layout = html.Div([
    html.Div([
        html.H1(
            "股票价格异常检测 - 实时仪表盘",
            style={
                'textAlign': 'center',
                'color': '#2c3e50',
                'marginBottom': '10px',
                'fontFamily': 'Arial, sans-serif'
            }
        ),
        html.Div(
            f"订阅 Kafka 主题: {ANOMALY_TOPIC}",
            style={
                'textAlign': 'center',
                'color': '#7f8c8d',
                'marginBottom': '20px'
            }
        )
    ], style={'backgroundColor': '#f8f9fa', 'padding': '20px', 'borderRadius': '10px', 'marginBottom': '20px'}),
    
    dcc.Interval(
        id='interval-component',
        interval=UPDATE_INTERVAL_MS,
        n_intervals=0
    ),
    
    html.Div(id='stats-cards', style={
        'display': 'flex',
        'flexWrap': 'wrap',
        'gap': '20px',
        'marginBottom': '20px',
        'justifyContent': 'center'
    }),
    
    html.Div([
        dcc.Graph(id='anomaly-chart', style={'height': '600px'})
    ], style={
        'backgroundColor': '#ffffff',
        'padding': '20px',
        'borderRadius': '10px',
        'boxShadow': '0 2px 10px rgba(0,0,0,0.1)'
    }),
    
    html.Div(id='anomaly-table-container', style={
        'marginTop': '20px',
        'backgroundColor': '#ffffff',
        'padding': '20px',
        'borderRadius': '10px',
        'boxShadow': '0 2px 10px rgba(0,0,0,0.1)'
    })
], style={'backgroundColor': '#ecf0f1', 'padding': '20px', 'minHeight': '100vh'})

@app.callback(
    Output('stats-cards', 'children'),
    Input('interval-component', 'n_intervals')
)
def update_stats_cards(n):
    while not anomaly_queue.empty():
        try:
            data = anomaly_queue.get_nowait()
            process_anomaly_data(data)
        except queue.Empty:
            break
    
    total_anomalies = sum(len(info['anomaly_indices']) for info in stock_data.values())
    unique_stocks = len(stock_data)
    
    cards = []
    
    cards.append(html.Div([
        html.Div("总异常数", style={'fontSize': '14px', 'color': '#7f8c8d', 'marginBottom': '5px'}),
        html.Div(str(total_anomalies), style={'fontSize': '36px', 'fontWeight': 'bold', 'color': '#e74c3c'})
    ], style={
        'backgroundColor': '#ffffff',
        'padding': '20px',
        'borderRadius': '10px',
        'minWidth': '180px',
        'textAlign': 'center',
        'boxShadow': '0 2px 10px rgba(0,0,0,0.1)'
    }))
    
    cards.append(html.Div([
        html.Div("涉及股票数", style={'fontSize': '14px', 'color': '#7f8c8d', 'marginBottom': '5px'}),
        html.Div(str(unique_stocks), style={'fontSize': '36px', 'fontWeight': 'bold', 'color': '#3498db'})
    ], style={
        'backgroundColor': '#ffffff',
        'padding': '20px',
        'borderRadius': '10px',
        'minWidth': '180px',
        'textAlign': 'center',
        'boxShadow': '0 2px 10px rgba(0,0,0,0.1)'
    }))
    
    if stock_data:
        latest_symbol = list(stock_data.keys())[-1]
        if stock_data[latest_symbol]['prices']:
            latest_price = stock_data[latest_symbol]['prices'][-1]
            cards.append(html.Div([
                html.Div(f"最新异常: {latest_symbol}", style={'fontSize': '14px', 'color': '#7f8c8d', 'marginBottom': '5px'}),
                html.Div(f"${latest_price}", style={'fontSize': '36px', 'fontWeight': 'bold', 'color': '#27ae60'})
            ], style={
                'backgroundColor': '#ffffff',
                'padding': '20px',
                'borderRadius': '10px',
                'minWidth': '180px',
                'textAlign': 'center',
                'boxShadow': '0 2px 10px rgba(0,0,0,0.1)'
            }))
    
    return cards

@app.callback(
    Output('anomaly-chart', 'figure'),
    Input('interval-component', 'n_intervals')
)
def update_chart(n):
    fig = go.Figure()
    
    colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e']
    color_idx = 0
    
    for symbol, data in stock_data.items():
        if len(data['timestamps']) == 0:
            continue
        
        timestamps = list(data['timestamps'])
        prices = list(data['prices'])
        moving_avgs = list(data['moving_averages'])
        anomaly_indices = list(data['anomaly_indices'])
        
        fig.add_trace(go.Scatter(
            x=timestamps,
            y=prices,
            mode='lines+markers',
            name=f'{symbol} 价格',
            line=dict(color=colors[color_idx % len(colors)], width=2),
            marker=dict(size=6),
            legendgroup=symbol
        ))
        
        fig.add_trace(go.Scatter(
            x=timestamps,
            y=moving_avgs,
            mode='lines',
            name=f'{symbol} 移动平均',
            line=dict(color=colors[color_idx % len(colors)], width=1, dash='dash'),
            legendgroup=symbol
        ))
        
        anomaly_x = [timestamps[i] for i in anomaly_indices]
        anomaly_y = [prices[i] for i in anomaly_indices]
        
        if anomaly_x:
            fig.add_trace(go.Scatter(
                x=anomaly_x,
                y=anomaly_y,
                mode='markers',
                name=f'{symbol} 异常点',
                marker=dict(
                    symbol='star',
                    size=14,
                    color='red',
                    line=dict(width=2, color='darkred')
                ),
                legendgroup=symbol,
                showlegend=True
            ))
        
        color_idx += 1
    
    fig.update_layout(
        title={
            'text': '股票价格异常检测 - 实时时间序列',
            'y': 0.95,
            'x': 0.5,
            'xanchor': 'center',
            'yanchor': 'top',
            'font': {'size': 20, 'color': '#2c3e50'}
        },
        xaxis_title='时间',
        yaxis_title='价格 ($)',
        hovermode='x unified',
        template='plotly_white',
        legend=dict(
            orientation='h',
            yanchor='bottom',
            y=1.02,
            xanchor='right',
            x=1
        ),
        margin=dict(l=50, r=50, t=80, b=50)
    )
    
    fig.update_xaxes(
        showgrid=True,
        gridwidth=1,
        gridcolor='rgba(0,0,0,0.05)',
        tickangle=45
    )
    
    fig.update_yaxes(
        showgrid=True,
        gridwidth=1,
        gridcolor='rgba(0,0,0,0.05)',
        zeroline=True,
        zerolinewidth=2,
        zerolinecolor='rgba(0,0,0,0.1)'
    )
    
    return fig

@app.callback(
    Output('anomaly-table-container', 'children'),
    Input('interval-component', 'n_intervals')
)
def update_table(n):
    all_anomalies = []
    
    for symbol, data in stock_data.items():
        for i, idx in enumerate(data['anomaly_indices']):
            all_anomalies.append({
                'symbol': symbol,
                'time': data['timestamps'][idx],
                'price': data['prices'][idx],
                'moving_avg': data['moving_averages'][idx]
            })
    
    all_anomalies.sort(key=lambda x: x['time'], reverse=True)
    recent_anomalies = all_anomalies[:10]
    
    if not recent_anomalies:
        return html.Div("暂无异常数据，等待检测...", style={
            'textAlign': 'center',
            'color': '#7f8c8d',
            'padding': '40px'
        })
    
    table_header = [
        html.Tr([
            html.Th('时间', style={'padding': '12px', 'textAlign': 'left', 'backgroundColor': '#34495e', 'color': 'white'}),
            html.Th('股票', style={'padding': '12px', 'textAlign': 'left', 'backgroundColor': '#34495e', 'color': 'white'}),
            html.Th('异常价格', style={'padding': '12px', 'textAlign': 'left', 'backgroundColor': '#34495e', 'color': 'white'}),
            html.Th('移动平均', style={'padding': '12px', 'textAlign': 'left', 'backgroundColor': '#34495e', 'color': 'white'}),
            html.Th('差值', style={'padding': '12px', 'textAlign': 'left', 'backgroundColor': '#34495e', 'color': 'white'})
        ])
    ]
    
    table_rows = []
    for anomaly in recent_anomalies:
        diff = anomaly['price'] - anomaly['moving_avg']
        diff_str = f"+${diff:.2f}" if diff > 0 else f"${diff:.2f}"
        diff_color = '#27ae60' if diff > 0 else '#e74c3c'
        
        table_rows.append(html.Tr([
            html.Td(anomaly['time'], style={'padding': '10px', 'borderBottom': '1px solid #ddd'}),
            html.Td(anomaly['symbol'], style={'padding': '10px', 'borderBottom': '1px solid #ddd', 'fontWeight': 'bold'}),
            html.Td(f"${anomaly['price']:.2f}", style={'padding': '10px', 'borderBottom': '1px solid #ddd'}),
            html.Td(f"${anomaly['moving_avg']:.2f}", style={'padding': '10px', 'borderBottom': '1px solid #ddd'}),
            html.Td(diff_str, style={'padding': '10px', 'borderBottom': '1px solid #ddd', 'color': diff_color, 'fontWeight': 'bold'})
        ]))
    
    return [
        html.H3("最近的异常事件 (最近10条)", style={'color': '#2c3e50', 'marginBottom': '15px'}),
        html.Table(
            table_header + table_rows,
            style={
                'width': '100%',
                'borderCollapse': 'collapse',
                'fontFamily': 'Arial, sans-serif'
            }
        )
    ]

if __name__ == '__main__':
    consumer_thread = threading.Thread(target=kafka_consumer_thread, daemon=True)
    consumer_thread.start()
    
    print("启动实时仪表盘...")
    print("请在浏览器中访问: http://127.0.0.1:8050")
    print("=" * 60)
    
    app.run_server(debug=True, host='0.0.0.0', port=8050)
