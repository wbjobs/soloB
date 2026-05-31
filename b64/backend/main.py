import asyncio
import random
import time
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CandlestickData(BaseModel):
    timestamp: float
    open: float
    high: float
    low: float
    close: float
    volume: float

class TradeData(BaseModel):
    timestamp: float
    price: float
    volume: float
    type: str

class DataGenerator:
    def __init__(self):
        self.current_price = 50000.0
        self.last_timestamp = time.time()
        self.volatility = 0.001
        self.trend = 0.0001

    def generate_trade(self) -> TradeData:
        timestamp = time.time()
        price_change = random.gauss(self.trend, self.volatility)
        self.current_price *= (1 + price_change)
        
        return TradeData(
            timestamp=timestamp,
            price=self.current_price,
            volume=random.uniform(0.1, 10.0),
            type=random.choice(["buy", "sell"])
        )

    def generate_candlestick(self, interval: int = 1) -> CandlestickData:
        timestamp = self.last_timestamp
        open_price = self.current_price
        
        high_price = open_price
        low_price = open_price
        total_volume = 0.0
        
        for _ in range(interval):
            trade = self.generate_trade()
            if trade.price > high_price:
                high_price = trade.price
            if trade.price < low_price:
                low_price = trade.price
            total_volume += trade.volume
        
        close_price = self.current_price
        self.last_timestamp = time.time()
        
        return CandlestickData(
            timestamp=timestamp,
            open=open_price,
            high=high_price,
            low=low_price,
            close=close_price,
            volume=total_volume
        )

data_generator = DataGenerator()

@app.get("/")
async def root():
    return {"message": "Financial Data Stream API"}

@app.get("/api/historical/{count}")
async def get_historical_data(count: int = 1000):
    historical_data = []
    for _ in range(count):
        candlestick = data_generator.generate_candlestick()
        historical_data.append(candlestick)
    return historical_data

@app.websocket("/ws/trades")
async def websocket_trades(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            trades = []
            for _ in range(1000):
                trade = data_generator.generate_trade()
                trades.append({
                    "timestamp": trade.timestamp,
                    "price": trade.price,
                    "volume": trade.volume,
                    "type": trade.type
                })
            
            await websocket.send_json({
                "type": "trades",
                "data": trades
            })
            
            await asyncio.sleep(1)
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.close()

@app.websocket("/ws/candlesticks")
async def websocket_candlesticks(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            candlesticks = []
            for _ in range(60):
                candlestick = data_generator.generate_candlestick()
                candlesticks.append({
                    "timestamp": candlestick.timestamp,
                    "open": candlestick.open,
                    "high": candlestick.high,
                    "low": candlestick.low,
                    "close": candlestick.close,
                    "volume": candlestick.volume
                })
            
            await websocket.send_json({
                "type": "candlesticks",
                "data": candlesticks
            })
            
            await asyncio.sleep(1)
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
