import asyncio
import json
import random
from datetime import datetime, timezone
from typing import Dict, List, Optional

class TickDataGenerator:
    def __init__(
        self,
        base_price: float = 60000.0,
        volatility: float = 0.002,
        ticks_per_second: int = 100
    ):
        self.base_price = base_price
        self.current_price = base_price
        self.volatility = volatility
        self.ticks_per_second = ticks_per_second
        self.clients = []
        self.running = False
        self.ask_orders = self._generate_initial_depth('ask')
        self.bid_orders = self._generate_initial_depth('bid')

    def _generate_initial_depth(self, side: str) -> List[Dict]:
        orders = []
        price_base = self.base_price
        if side == 'ask':
            for i in range(20):
                price = price_base + (i + 1) * random.uniform(0.5, 2.0)
                quantity = random.uniform(0.1, 10.0)
                orders.append({'price': price, 'quantity': quantity})
        else:
            for i in range(20):
                price = price_base - (i + 1) * random.uniform(0.5, 2.0)
                quantity = random.uniform(0.1, 10.0)
                orders.append({'price': price, 'quantity': quantity})
        return orders

    def _update_depth(self):
        for side in ['ask', 'bid']:
            orders = self.ask_orders if side == 'ask' else self.bid_orders
            if random.random() < 0.3:
                idx = random.randint(0, len(orders) - 1)
                orders[idx]['quantity'] *= random.uniform(0.8, 1.2)
                if orders[idx]['quantity'] < 0.01:
                    orders[idx]['quantity'] = random.uniform(0.1, 10.0)

            if random.random() < 0.1:
                price_offset = random.uniform(-10, 10)
                if side == 'ask':
                    price = self.current_price + abs(price_offset) + random.uniform(0.5, 2.0)
                else:
                    price = self.current_price - abs(price_offset) - random.uniform(0.5, 2.0)
                quantity = random.uniform(0.1, 5.0)
                orders.append({'price': price, 'quantity': quantity})

                orders.sort(key=lambda x: x['price'], reverse=(side == 'bid'))
                if len(orders) > 50:
                    orders.pop()

    def _generate_tick(self) -> Dict:
        now = datetime.now(timezone.utc)
        timestamp = int(now.timestamp() * 1000)

        price_change = self.current_price * self.volatility * random.uniform(-1, 1)
        self.current_price = max(self.base_price * 0.5, min(self.base_price * 1.5, self.current_price + price_change))

        quantity = random.uniform(0.01, 2.0)
        side = 'buy' if random.random() < 0.5 else 'sell'

        self._update_depth()

        return {
            'timestamp': timestamp,
            'price': round(self.current_price, 2),
            'quantity': round(quantity, 4),
            'side': side,
            'asks': [{'price': round(o['price'], 2), 'quantity': round(o['quantity'], 4)} for o in self.ask_orders[:20]],
            'bids': [{'price': round(o['price'], 2), 'quantity': round(o['quantity'], 4)} for o in self.bid_orders[:20]]
        }

    async def add_client(self, websocket):
        self.clients.append(websocket)
        try:
            while True:
                await websocket.receive_text()
        except Exception:
            pass
        finally:
            if websocket in self.clients:
                self.clients.remove(websocket)

    async def broadcast_tick(self, tick: Dict):
        message = json.dumps(tick)
        disconnected_clients = []
        for ws in self.clients:
            try:
                await ws.send_text(message)
            except Exception:
                disconnected_clients.append(ws)
        for ws in disconnected_clients:
            if ws in self.clients:
                self.clients.remove(ws)

    async def start(self):
        self.running = True
        interval = 1.0 / self.ticks_per_second
        while self.running:
            tick = self._generate_tick()
            await self.broadcast_tick(tick)
            await asyncio.sleep(interval)

    def stop(self):
        self.running = False
