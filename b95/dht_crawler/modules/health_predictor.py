import os
import pickle
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

class HealthPredictor:
    def __init__(self, model_dir: str = "models"):
        self.model_dir = model_dir
        self.model: Optional[lgb.LGBMRegressor] = None
        self.scaler: Optional[StandardScaler] = None
        self.feature_columns = [
            'current_peers', 'reachable_ratio', 'avg_peer_age_hours',
            'isp_diversity', 'country_diversity', 'region_diversity',
            'integrity_score', 'seeder_count', 'leecher_count',
            'hour_of_day', 'day_of_week', 'time_since_first_seen_hours'
        ]
        os.makedirs(model_dir, exist_ok=True)
    
    def generate_sample_history_data(self, num_samples: int = 1000) -> pd.DataFrame:
        np.random.seed(42)
        
        data = []
        for i in range(num_samples):
            base_time = datetime.now() - timedelta(days=np.random.randint(1, 30))
            
            current_peers = np.random.randint(5, 200)
            reachable_ratio = np.random.uniform(0.3, 0.95)
            
            isp_diversity = np.random.uniform(0.2, 0.9)
            country_diversity = np.random.uniform(0.1, 0.8)
            region_diversity = np.random.uniform(0.1, 0.7)
            
            integrity_score = np.random.uniform(0.5, 1.0)
            seeder_count = int(current_peers * np.random.uniform(0.3, 0.8))
            leecher_count = current_peers - seeder_count
            
            hour_of_day = base_time.hour
            day_of_week = base_time.weekday()
            time_since_first_seen = np.random.randint(1, 720)
            
            avg_peer_age = np.random.uniform(1, 48)
            
            decay_factor = 0.95 + (integrity_score * 0.03) + (reachable_ratio * 0.02)
            peers_24h = int(current_peers * decay_factor * (1 + 0.1 * np.random.randn()))
            peers_24h = max(0, peers_24h)
            
            survival_probability = min(1.0, (peers_24h / max(1, current_peers)) * (0.5 + integrity_score * 0.5))
            
            data.append({
                'infohash': f'sample_{i:04d}',
                'timestamp': base_time,
                'current_peers': current_peers,
                'reachable_ratio': reachable_ratio,
                'avg_peer_age_hours': avg_peer_age,
                'isp_diversity': isp_diversity,
                'country_diversity': country_diversity,
                'region_diversity': region_diversity,
                'integrity_score': integrity_score,
                'seeder_count': seeder_count,
                'leecher_count': leecher_count,
                'hour_of_day': hour_of_day,
                'day_of_week': day_of_week,
                'time_since_first_seen_hours': time_since_first_seen,
                'peers_24h_later': peers_24h,
                'survival_probability': survival_probability
            })
        
        return pd.DataFrame(data)
    
    def train_model(self, training_data: Optional[pd.DataFrame] = None) -> Dict:
        if training_data is None:
            training_data = self.generate_sample_history_data(1000)
        
        X = training_data[self.feature_columns].values
        y_peers = training_data['peers_24h_later'].values
        y_survival = training_data['survival_probability'].values
        
        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X)
        
        X_train, X_test, y_peers_train, y_peers_test, y_surv_train, y_surv_test = train_test_split(
            X_scaled, y_peers, y_survival, test_size=0.2, random_state=42
        )
        
        self.model = lgb.LGBMRegressor(
            n_estimators=200,
            learning_rate=0.05,
            max_depth=8,
            num_leaves=31,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            verbose=-1
        )
        
        self.model.fit(X_train, y_peers_train)
        
        y_pred_peers = self.model.predict(X_test)
        
        peers_metrics = {
            'mse': mean_squared_error(y_peers_test, y_pred_peers),
            'mae': mean_absolute_error(y_peers_test, y_pred_peers),
            'rmse': np.sqrt(mean_squared_error(y_peers_test, y_pred_peers)),
            'r2': r2_score(y_peers_test, y_pred_peers)
        }
        
        survival_model = lgb.LGBMRegressor(
            n_estimators=200,
            learning_rate=0.05,
            max_depth=8,
            num_leaves=31,
            random_state=42,
            verbose=-1
        )
        survival_model.fit(X_train, y_surv_train)
        y_pred_surv = survival_model.predict(X_test)
        
        survival_metrics = {
            'mse': mean_squared_error(y_surv_test, y_pred_surv),
            'mae': mean_absolute_error(y_surv_test, y_pred_surv),
            'rmse': np.sqrt(mean_squared_error(y_surv_test, y_pred_surv)),
            'r2': r2_score(y_surv_test, y_pred_surv)
        }
        
        self.survival_model = survival_model
        
        feature_importance = dict(zip(
            self.feature_columns,
            self.model.feature_importances_.tolist()
        ))
        
        return {
            'peers_prediction_metrics': peers_metrics,
            'survival_prediction_metrics': survival_metrics,
            'feature_importance': dict(sorted(feature_importance.items(), key=lambda x: -x[1])),
            'training_samples': len(training_data)
        }
    
    def predict_health(self, current_status: Dict) -> Dict:
        if self.model is None:
            print("Model not trained, training with sample data...")
            self.train_model()
        
        features = []
        for col in self.feature_columns:
            val = current_status.get(col, 0)
            if col in ['reachable_ratio', 'isp_diversity', 'country_diversity', 
                       'region_diversity', 'integrity_score']:
                val = max(0, min(1, val))
            features.append(val)
        
        X = np.array(features).reshape(1, -1)
        X_scaled = self.scaler.transform(X)
        
        predicted_peers_24h = int(self.model.predict(X_scaled)[0])
        predicted_peers_24h = max(0, predicted_peers_24h)
        
        survival_probability = float(self.survival_model.predict(X_scaled)[0])
        survival_probability = max(0, min(1, survival_probability))
        
        current_peers = current_status.get('current_peers', 0)
        peer_change_ratio = predicted_peers_24h / max(1, current_peers)
        
        health_score = (
            survival_probability * 0.4 +
            min(1.0, peer_change_ratio) * 0.3 +
            current_status.get('reachable_ratio', 0) * 0.2 +
            current_status.get('integrity_score', 0) * 0.1
        )
        
        if health_score >= 0.8:
            health_level = "Excellent"
        elif health_score >= 0.6:
            health_level = "Good"
        elif health_score >= 0.4:
            health_level = "Fair"
        elif health_score >= 0.2:
            health_level = "Poor"
        else:
            health_level = "Critical"
        
        hourly_trend = self._predict_hourly_trend(features, hours=24)
        
        return {
            'predicted_peers_24h': predicted_peers_24h,
            'current_peers': current_peers,
            'peer_change_percentage': round((predicted_peers_24h - current_peers) / max(1, current_peers) * 100, 2),
            'survival_probability_24h': round(survival_probability, 4),
            'health_score': round(health_score, 4),
            'health_level': health_level,
            'hourly_trend': hourly_trend,
            'risk_factors': self._identify_risk_factors(current_status)
        }
    
    def _predict_hourly_trend(self, base_features: List, hours: int = 24) -> List[Dict]:
        trend = []
        base_peers = base_features[0]
        
        for hour in range(hours + 1):
            hour_factor = 1 - (hour * 0.005)
            hour_factor *= (0.95 + 0.1 * np.random.rand())
            
            peers = int(base_peers * max(0.3, hour_factor))
            
            trend.append({
                'hour': hour,
                'predicted_peers': max(0, peers)
            })
        
        return trend
    
    def _identify_risk_factors(self, current_status: Dict) -> List[str]:
        risks = []
        
        if current_status.get('current_peers', 0) < 10:
            risks.append("Low peer count - limited availability")
        
        if current_status.get('reachable_ratio', 1) < 0.4:
            risks.append("Low peer reachability - many peers are offline/firewalled")
        
        if current_status.get('integrity_score', 1) < 0.7:
            risks.append("Low file integrity - potential corruption or fake files")
        
        if current_status.get('isp_diversity', 1) < 0.3:
            risks.append("Low ISP diversity - risk of single point of failure")
        
        if current_status.get('seeder_count', 0) < 3:
            risks.append("Low seeder count - poor long-term availability")
        
        return risks
    
    def save_model(self, filename: str = "health_model.pkl"):
        model_path = os.path.join(self.model_dir, filename)
        with open(model_path, 'wb') as f:
            pickle.dump({
                'model': self.model,
                'survival_model': self.survival_model,
                'scaler': self.scaler,
                'feature_columns': self.feature_columns
            }, f)
        print(f"Model saved to {model_path}")
    
    def load_model(self, filename: str = "health_model.pkl") -> bool:
        model_path = os.path.join(self.model_dir, filename)
        if not os.path.exists(model_path):
            return False
        
        try:
            with open(model_path, 'rb') as f:
                data = pickle.load(f)
                self.model = data['model']
                self.survival_model = data['survival_model']
                self.scaler = data['scaler']
                self.feature_columns = data['feature_columns']
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            return False
