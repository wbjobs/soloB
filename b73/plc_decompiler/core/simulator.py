import sys
import importlib.util
from typing import Dict, Any, Optional
from datetime import datetime
from ..models.plc_models import (
    ExecutionLog,
    ExecutionStep,
    PlcState
)


class Simulator:
    def __init__(self):
        self.executor = None

    def load_code(self, python_code: str, module_name: str = "plc_generated") -> bool:
        try:
            spec = importlib.util.spec_from_loader(module_name, loader=None)
            module = importlib.util.module_from_spec(spec)
            
            exec(python_code, module.__dict__)
            sys.modules[module_name] = module
            
            self.executor = module.PLCProgramExecutor()
            return True
        except Exception as e:
            print(f"Error loading code: {e}")
            return False

    def execute(self, cycles: int = 10, inputs: Optional[Dict[str, bool]] = None,
                program_name: str = "") -> Dict[str, Any]:
        if not self.executor:
            raise ValueError("No PLC program loaded")
        
        result = self.executor.run(cycles=cycles, inputs=inputs)
        
        execution_log = self._build_execution_log(program_name, result, cycles)
        final_state = self._build_final_state(result['final_state'])
        
        return {
            'execution_log': execution_log,
            'final_state': final_state,
            'raw_result': result
        }

    def _build_execution_log(self, program_name: str, result: Dict[str, Any], 
                             cycles: int) -> ExecutionLog:
        steps = []
        raw_log = result.get('execution_log', [])
        
        for i, entry in enumerate(raw_log):
            step = ExecutionStep(
                cycle=i // len(raw_log) if len(raw_log) > 0 else 0,
                rung_id=0,
                element_id=entry.get('element_id', 0),
                element_name=entry.get('element_name', ''),
                input_value=entry.get('input_value', False),
                output_value=entry.get('output_value', False),
                timestamp=entry.get('timestamp', datetime.now())
            )
            steps.append(step)
        
        return ExecutionLog(
            program_name=program_name,
            total_cycles=cycles,
            steps=steps
        )

    def _build_final_state(self, raw_state: Dict[str, Any]) -> PlcState:
        return PlcState(
            inputs=raw_state.get('inputs', {}),
            outputs=raw_state.get('outputs', {}),
            timers=raw_state.get('timers', {}),
            counters=raw_state.get('counters', {}),
            internal={}
        )

    def get_state(self) -> Optional[Dict[str, Any]]:
        if self.executor:
            return {
                'inputs': dict(self.executor.state.inputs),
                'outputs': dict(self.executor.state.outputs),
                'timers': dict(self.executor.state.timers),
                'counters': dict(self.executor.state.counters),
                'internal': dict(self.executor.state.internal)
            }
        return None
