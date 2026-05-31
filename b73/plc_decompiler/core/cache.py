import sqlite3
import json
import hashlib
from datetime import datetime
from typing import Optional, Dict, Any
from pathlib import Path


class Cache:
    def __init__(self, db_path: str = "plc_cache.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS compiled_programs (
                cache_key TEXT PRIMARY KEY,
                program_name TEXT NOT NULL,
                xml_content TEXT NOT NULL,
                python_code TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS execution_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cache_key TEXT NOT NULL,
                cycles INTEGER NOT NULL,
                initial_inputs TEXT,
                result_json TEXT,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (cache_key) REFERENCES compiled_programs(cache_key)
            )
        ''')
        
        conn.commit()
        conn.close()

    @staticmethod
    def generate_key(content: str) -> str:
        return hashlib.md5(content.encode('utf-8')).hexdigest()

    def get_compiled_program(self, cache_key: str) -> Optional[Dict[str, Any]]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT program_name, xml_content, python_code, created_at
            FROM compiled_programs
            WHERE cache_key = ?
        ''', (cache_key,))
        
        row = cursor.fetchone()
        
        if row:
            cursor.execute('''
                UPDATE compiled_programs
                SET last_accessed = CURRENT_TIMESTAMP
                WHERE cache_key = ?
            ''', (cache_key,))
            conn.commit()
            
            result = {
                'program_name': row['program_name'],
                'xml_content': row['xml_content'],
                'python_code': row['python_code'],
                'created_at': row['created_at']
            }
        else:
            result = None
        
        conn.close()
        return result

    def save_compiled_program(self, cache_key: str, program_name: str, 
                              xml_content: str, python_code: str) -> bool:
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT OR REPLACE INTO compiled_programs 
                (cache_key, program_name, xml_content, python_code, created_at, last_accessed)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ''', (cache_key, program_name, xml_content, python_code))
            
            conn.commit()
            conn.close()
            return True
        except Exception:
            return False

    def save_execution_result(self, cache_key: str, cycles: int, 
                              initial_inputs: Dict[str, bool], 
                              result: Dict[str, Any]) -> int:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        inputs_json = json.dumps(initial_inputs)
        result_json = json.dumps(result, default=str)
        
        cursor.execute('''
            INSERT INTO execution_results 
            (cache_key, cycles, initial_inputs, result_json)
            VALUES (?, ?, ?, ?)
        ''', (cache_key, cycles, inputs_json, result_json))
        
        result_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return result_id

    def get_execution_history(self, cache_key: str, limit: int = 10) -> list:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT cycles, initial_inputs, result_json, executed_at
            FROM execution_results
            WHERE cache_key = ?
            ORDER BY executed_at DESC
            LIMIT ?
        ''', (cache_key, limit))
        
        rows = cursor.fetchall()
        results = []
        
        for row in rows:
            results.append({
                'cycles': row['cycles'],
                'initial_inputs': json.loads(row['initial_inputs']),
                'result': json.loads(row['result_json']),
                'executed_at': row['executed_at']
            })
        
        conn.close()
        return results

    def clear_old_entries(self, days: int = 30) -> int:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            DELETE FROM compiled_programs 
            WHERE last_accessed < datetime('now', '-' || ? || ' days')
        ''', (days,))
        
        deleted = cursor.rowcount
        conn.commit()
        conn.close()
        
        return deleted
