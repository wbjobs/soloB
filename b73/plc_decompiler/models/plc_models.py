from typing import List, Dict, Optional, Any
from pydantic import BaseModel
from datetime import datetime
from enum import Enum


class ElementType(str, Enum):
    NO_CONTACT = "no_contact"
    NC_CONTACT = "nc_contact"
    COIL = "coil"
    TIMER = "timer"
    COUNTER = "counter"


class Element(BaseModel):
    id: str
    type: ElementType
    name: str
    address: str


class NOContact(Element):
    type: ElementType = ElementType.NO_CONTACT


class NCContact(Element):
    type: ElementType = ElementType.NC_CONTACT


class Coil(Element):
    type: ElementType = ElementType.COIL


class Timer(Element):
    type: ElementType = ElementType.TIMER
    preset: int
    time_base: float = 1.0


class Counter(Element):
    type: ElementType = ElementType.COUNTER
    preset: int


class Rung(BaseModel):
    id: int
    elements: List[Element]
    logic: str


class PLCProgram(BaseModel):
    name: str
    description: str
    rungs: List[Rung]
    inputs: Dict[str, bool] = {}
    outputs: Dict[str, bool] = {}


class PlcState(BaseModel):
    inputs: Dict[str, bool] = {}
    outputs: Dict[str, bool] = {}
    timers: Dict[str, Dict[str, Any]] = {}
    counters: Dict[str, Dict[str, Any]] = {}
    internal: Dict[str, bool] = {}


class ExecutionStep(BaseModel):
    cycle: int
    rung_id: int
    element_id: int
    element_name: str
    input_value: bool
    output_value: bool
    timestamp: datetime


class ExecutionLog(BaseModel):
    program_name: str
    total_cycles: int
    steps: List[ExecutionStep] = []


class CompileRequest(BaseModel):
    xml_content: str


class CompileResponse(BaseModel):
    program_name: str
    python_code: str
    cache_key: str


class SimulateRequest(BaseModel):
    cache_key: str
    cycles: int = 10
    initial_inputs: Dict[str, bool] = {}


class SimulateResponse(BaseModel):
    program_name: str
    execution_log: ExecutionLog
    final_state: PlcState
