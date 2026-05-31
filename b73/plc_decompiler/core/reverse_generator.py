import ast
import re
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
import xml.etree.ElementTree as ET
from xml.dom import minidom


@dataclass
class PlcElement:
    id: int
    type: str
    name: str
    address: str
    preset: Optional[int] = None
    time_base: Optional[float] = None


@dataclass
class RungInfo:
    id: int
    logic: str
    conditions: List[PlcElement]
    outputs: List[PlcElement]


class ReverseGenerator:
    def __init__(self):
        self.inputs: Dict[str, str] = {}
        self.outputs: Dict[str, str] = {}
        self.timers: Dict[str, Dict[str, Any]] = {}
        self.counters: Dict[str, Dict[str, Any]] = {}
        self.rungs: List[RungInfo] = []
        self.next_id = 1

    def analyze_code(self, python_code: str) -> Dict[str, Any]:
        tree = ast.parse(python_code)
        self._reset()
        self._extract_io_addresses(tree)
        self._extract_rung_methods(tree)
        return self._build_result()

    def _reset(self):
        self.inputs = {}
        self.outputs = {}
        self.timers = {}
        self.counters = {}
        self.rungs = []
        self.next_id = 1

    def _extract_io_addresses(self, tree: ast.AST):
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Subscript):
                        addr = self._extract_address(target)
                        if addr:
                            if 'I' in addr:
                                self.inputs[addr] = f"Input {addr}"
                            elif 'Q' in addr:
                                self.outputs[addr] = f"Output {addr}"
                            elif 'T' in addr:
                                self.timers[addr] = {'name': f"Timer {addr}", 'preset': 100}
                            elif 'C' in addr:
                                self.counters[addr] = {'name': f"Counter {addr}", 'preset': 10}

    def _extract_address(self, subscript: ast.Subscript) -> Optional[str]:
        try:
            if isinstance(subscript.slice, ast.Constant):
                return str(subscript.slice.value)
            elif isinstance(subscript.slice, ast.Str):
                return subscript.slice.s
        except:
            pass
        return None

    def _extract_rung_methods(self, tree: ast.AST):
        rung_id = 1
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name.startswith('_execute_rung_'):
                rung_info = self._analyze_rung_function(node, rung_id)
                if rung_info:
                    self.rungs.append(rung_info)
                    rung_id += 1

        if not self.rungs:
            self._analyze_run_method(tree)

    def _analyze_rung_function(self, func_def: ast.FunctionDef, rung_id: int) -> Optional[RungInfo]:
        docstring = ast.get_docstring(func_def)
        logic_desc = docstring.split(':')[1].strip() if docstring and ':' in docstring else f"Rung {rung_id} Logic"
        
        conditions = []
        outputs = []
        
        for node in ast.walk(func_def):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Subscript):
                        addr = self._extract_address(target)
                        if addr and addr.startswith('Q'):
                            outputs.append(PlcElement(
                                id=self._get_next_id(),
                                type='coil',
                                name=f"Coil {addr}",
                                address=addr
                            ))
        
        for node in ast.walk(func_def):
            if isinstance(node, ast.BoolOp) or isinstance(node, ast.Compare):
                cond_elements = self._extract_conditions(node)
                conditions.extend(cond_elements)
        
        if not conditions and outputs:
            conditions = self._infer_conditions_from_assign(func_def, outputs)
        
        return RungInfo(
            id=rung_id,
            logic=logic_desc,
            conditions=conditions,
            outputs=outputs
        )

    def _infer_conditions_from_assign(self, func_def: ast.FunctionDef, outputs: List[PlcElement]) -> List[PlcElement]:
        conditions = []
        for node in ast.walk(func_def):
            if isinstance(node, ast.If):
                cond_elements = self._extract_conditions(node.test)
                conditions.extend(cond_elements)
        
        if not conditions:
            for addr in list(self.inputs.keys())[:2]:
                if addr.startswith('I'):
                    if len(conditions) == 0:
                        conditions.append(PlcElement(
                            id=self._get_next_id(),
                            type='no_contact',
                            name=f"Start {addr}",
                            address=addr
                        ))
                    else:
                        conditions.append(PlcElement(
                            id=self._get_next_id(),
                            type='nc_contact',
                            name=f"Stop {addr}",
                            address=addr
                        ))
        
        return conditions

    def _extract_conditions(self, expr: ast.expr, negated: bool = False) -> List[PlcElement]:
        elements = []
        
        if isinstance(expr, ast.BoolOp):
            for val in expr.values:
                elements.extend(self._extract_conditions(val, negated))
        
        elif isinstance(expr, ast.UnaryOp) and isinstance(expr.op, ast.Not):
            elements.extend(self._extract_conditions(expr.operand, negated=True))
        
        elif isinstance(expr, ast.Call):
            func_name = self._get_func_name(expr.func)
            if 'timer' in func_name.lower() or 'get' in func_name.lower():
                addr = self._extract_addr_from_call(expr)
                if addr and addr.startswith('T'):
                    elements.append(PlcElement(
                        id=self._get_next_id(),
                        type='timer',
                        name=f"Timer {addr}",
                        address=addr,
                        preset=100
                    ))
                elif addr and addr.startswith('C'):
                    elements.append(PlcElement(
                        id=self._get_next_id(),
                        type='counter',
                        name=f"Counter {addr}",
                        address=addr,
                        preset=10
                    ))
        
        elif isinstance(expr, ast.Subscript):
            addr = self._extract_address(expr)
            if addr and addr.startswith('I'):
                element_type = 'nc_contact' if negated else 'no_contact'
                element_name = f"{'NOT ' if negated else ''}Input {addr}"
                elements.append(PlcElement(
                    id=self._get_next_id(),
                    type=element_type,
                    name=element_name,
                    address=addr
                ))
        
        return elements

    def _get_func_name(self, func: ast.expr) -> str:
        if isinstance(func, ast.Attribute):
            return func.attr
        elif isinstance(func, ast.Name):
            return func.id
        return ""

    def _extract_addr_from_call(self, call: ast.Call) -> Optional[str]:
        for arg in call.args:
            if isinstance(arg, ast.Constant):
                return str(arg.value)
            elif isinstance(arg, ast.Str):
                return arg.s
        return None

    def _analyze_run_method(self, tree: ast.AST):
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == 'run':
                self._analyze_method_body(node)

    def _analyze_method_body(self, func_def: ast.FunctionDef):
        rung_id = 1
        
        for addr in sorted(self.inputs.keys()):
            if rung_id > 5:
                break
            conditions = [PlcElement(
                id=self._get_next_id(),
                type='no_contact',
                name=f"Input {addr}",
                address=addr
            )]
            
            output_addr = list(self.outputs.keys())[rung_id - 1] if rung_id <= len(self.outputs) else f"Q{rung_id-1}.0"
            outputs = [PlcElement(
                id=self._get_next_id(),
                type='coil',
                name=f"Output {output_addr}",
                address=output_addr
            )]
            
            self.rungs.append(RungInfo(
                id=rung_id,
                logic=f"Rung {rung_id} Logic",
                conditions=conditions,
                outputs=outputs
            ))
            rung_id += 1

    def _get_next_id(self) -> int:
        current = self.next_id
        self.next_id += 1
        return current

    def _build_result(self) -> Dict[str, Any]:
        return {
            'inputs': self.inputs,
            'outputs': self.outputs,
            'timers': self.timers,
            'counters': self.counters,
            'rungs': self.rungs
        }

    def generate_xml(self, program_name: str = "Reverse Engineered PLC Program",
                    description: str = "Generated from Python code") -> str:
        root = ET.Element('plc_program')
        
        name_elem = ET.SubElement(root, 'name')
        name_elem.text = program_name
        
        desc_elem = ET.SubElement(root, 'description')
        desc_elem.text = description
        
        inputs_elem = ET.SubElement(root, 'inputs')
        for addr, name in self.inputs.items():
            io_elem = ET.SubElement(inputs_elem, 'io')
            io_elem.set('name', name)
            io_elem.set('address', addr)
        
        outputs_elem = ET.SubElement(root, 'outputs')
        for addr, name in self.outputs.items():
            io_elem = ET.SubElement(outputs_elem, 'io')
            io_elem.set('name', name)
            io_elem.set('address', addr)
        
        rungs_elem = ET.SubElement(root, 'rungs')
        
        if not self.rungs:
            self._generate_default_rungs()
        
        for rung_info in self.rungs:
            rung_elem = ET.SubElement(rungs_elem, 'rung')
            rung_elem.set('id', str(rung_info.id))
            
            logic_elem = ET.SubElement(rung_elem, 'logic')
            logic_elem.text = rung_info.logic
            
            elements_elem = ET.SubElement(rung_elem, 'elements')
            
            for cond in rung_info.conditions:
                self._add_element(elements_elem, cond)
            
            for output in rung_info.outputs:
                self._add_element(elements_elem, output)
        
        rough_string = ET.tostring(root, 'utf-8')
        reparsed = minidom.parseString(rough_string)
        pretty_xml = reparsed.toprettyxml(indent="    ")
        
        return pretty_xml

    def _generate_default_rungs(self):
        if not self.inputs and not self.outputs:
            self.inputs = {'I0.0': 'Start Button', 'I0.1': 'Stop Button'}
            self.outputs = {'Q0.0': 'Motor Output'}
        
        rung_id = 1
        for i, (in_addr, in_name) in enumerate(self.inputs.items()):
            out_addr = list(self.outputs.keys())[i] if i < len(self.outputs) else f"Q{i}.0"
            
            conditions = [PlcElement(
                id=self._get_next_id(),
                type='no_contact',
                name=in_name,
                address=in_addr
            )]
            
            outputs = [PlcElement(
                id=self._get_next_id(),
                type='coil',
                name=self.outputs.get(out_addr, f"Output {out_addr}"),
                address=out_addr
            )]
            
            self.rungs.append(RungInfo(
                id=rung_id,
                logic=f"Rung {rung_id}: {in_name} -> {out_addr}",
                conditions=conditions,
                outputs=outputs
            ))
            rung_id += 1

    def _add_element(self, parent: ET.Element, elem: PlcElement):
        elem_elem = ET.SubElement(parent, elem.type)
        elem_elem.set('id', str(elem.id))
        elem_elem.set('name', elem.name)
        elem_elem.set('address', elem.address)
        
        if elem.preset is not None:
            elem_elem.set('preset', str(elem.preset))
        if elem.time_base is not None:
            elem_elem.set('time_base', str(elem.time_base))


def python_to_ladder_xml(python_code: str, program_name: str = None) -> Tuple[str, Dict[str, Any]]:
    generator = ReverseGenerator()
    analysis = generator.analyze_code(python_code)
    
    if program_name is None:
        program_name = "PLC Program (Reverse Engineered)"
    
    xml_content = generator.generate_xml(program_name)
    return xml_content, analysis
