import xml.etree.ElementTree as ET
from typing import Dict, List, Any, Optional
import hashlib
import re
from ..models.plc_models import (
    PLCProgram,
    Rung,
    Element,
    NOContact,
    NCContact,
    Coil,
    Timer,
    Counter,
    ElementType
)


class XMLParser:
    def __init__(self):
        self.element_factories = {
            'no_contact': self._create_no_contact,
            'nc_contact': self._create_nc_contact,
            'coil': self._create_coil,
            'timer': self._create_timer,
            'counter': self._create_counter
        }
        self.ns_map: Dict[str, str] = {}

    def _extract_namespaces(self, xml_content: str) -> Dict[str, str]:
        ns_pattern = r'xmlns:?(\w*)\s*=\s*["\']([^"\']+)["\']'
        matches = re.findall(ns_pattern, xml_content)
        ns_map = {}
        for prefix, uri in matches:
            if prefix:
                ns_map[prefix] = uri
            else:
                ns_map['default'] = uri
        return ns_map

    def _strip_namespace(self, tag: str) -> str:
        if '}' in tag:
            return tag.split('}')[-1]
        return tag

    def _find_with_ns(self, element: ET.Element, path: str) -> Optional[ET.Element]:
        result = element.find(path)
        if result is not None:
            return result
        
        for ns_uri in self.ns_map.values():
            ns_path = path.replace('/', f'/{{{ns_uri}}}')
            result = element.find(f'{{{ns_uri}}}{path}')
            if result is not None:
                return result
            
            parts = path.split('/')
            ns_parts = [f'{{{ns_uri}}}{part}' for part in parts]
            ns_path = '/'.join(ns_parts)
            result = element.find(ns_path)
            if result is not None:
                return result
        
        return None

    def _findall_with_ns(self, element: ET.Element, path: str) -> List[ET.Element]:
        result = element.findall(path)
        if result:
            return result
        
        for ns_uri in self.ns_map.values():
            ns_path = f'{{{ns_uri}}}{path}'
            result = element.findall(ns_path)
            if result:
                return result
            
            parts = path.split('/')
            ns_parts = [f'{{{ns_uri}}}{part}' for part in parts]
            ns_path = '/'.join(ns_parts)
            result = element.findall(ns_path)
            if result:
                return result
        
        return []

    def _findtext_with_ns(self, element: ET.Element, path: str, default: str = '') -> str:
        result = element.findtext(path, default)
        if result != default:
            return result
        
        for ns_uri in self.ns_map.values():
            ns_path = f'{{{ns_uri}}}{path}'
            result = element.findtext(ns_path, default)
            if result != default:
                return result
        return default

    def parse(self, xml_content: str) -> PLCProgram:
        self.ns_map = self._extract_namespaces(xml_content)
        root = ET.fromstring(xml_content)
        
        program_name = self._findtext_with_ns(root, 'name', 'Unnamed Program')
        description = self._findtext_with_ns(root, 'description', '')
        
        inputs = self._parse_io_section(root, 'inputs')
        outputs = self._parse_io_section(root, 'outputs')
        
        rungs = self._parse_rungs(root)
        
        return PLCProgram(
            name=program_name,
            description=description,
            rungs=rungs,
            inputs=inputs,
            outputs=outputs
        )

    def _parse_io_section(self, root: ET.Element, section_name: str) -> Dict[str, bool]:
        result = {}
        section = self._find_with_ns(root, section_name)
        if section is not None:
            for io_elem in self._findall_with_ns(section, 'io'):
                name = io_elem.get('name')
                address = io_elem.get('address')
                if address:
                    result[address] = False
        return result

    def _parse_rungs(self, root: ET.Element) -> List[Rung]:
        rungs = []
        rungs_section = self._find_with_ns(root, 'rungs')
        if rungs_section is None:
            return rungs
            
        for rung_elem in self._findall_with_ns(rungs_section, 'rung'):
            rung_id = int(rung_elem.get('id', 0))
            logic = self._findtext_with_ns(rung_elem, 'logic', '')
            
            elements = []
            elements_section = self._find_with_ns(rung_elem, 'elements')
            if elements_section is not None:
                for elem in elements_section:
                    element = self._parse_element(elem)
                    if element:
                        elements.append(element)
            
            rungs.append(Rung(
                id=rung_id,
                elements=elements,
                logic=logic
            ))
        
        return rungs

    def _parse_element(self, elem: ET.Element) -> Optional[Element]:
        elem_type = self._strip_namespace(elem.tag)
        factory = self.element_factories.get(elem_type)
        
        if factory:
            return factory(elem)
        return None

    def _safe_get_int(self, elem: ET.Element, attr: str, default: int) -> int:
        value = elem.get(attr)
        if value is None:
            return default
        try:
            return int(value)
        except (ValueError, TypeError):
            return default

    def _safe_get_float(self, elem: ET.Element, attr: str, default: float) -> float:
        value = elem.get(attr)
        if value is None:
            return default
        try:
            return float(value)
        except (ValueError, TypeError):
            return default

    def _create_no_contact(self, elem: ET.Element) -> NOContact:
        return NOContact(
            id=elem.get('id', ''),
            name=elem.get('name', ''),
            address=elem.get('address', '')
        )

    def _create_nc_contact(self, elem: ET.Element) -> NCContact:
        return NCContact(
            id=elem.get('id', ''),
            name=elem.get('name', ''),
            address=elem.get('address', '')
        )

    def _create_coil(self, elem: ET.Element) -> Coil:
        return Coil(
            id=elem.get('id', ''),
            name=elem.get('name', ''),
            address=elem.get('address', '')
        )

    def _create_timer(self, elem: ET.Element) -> Timer:
        return Timer(
            id=elem.get('id', ''),
            name=elem.get('name', ''),
            address=elem.get('address', ''),
            preset=self._safe_get_int(elem, 'preset', 100),
            time_base=self._safe_get_float(elem, 'time_base', 1.0)
        )

    def _create_counter(self, elem: ET.Element) -> Counter:
        return Counter(
            id=elem.get('id', ''),
            name=elem.get('name', ''),
            address=elem.get('address', ''),
            preset=self._safe_get_int(elem, 'preset', 10)
        )

    @staticmethod
    def generate_cache_key(xml_content: str) -> str:
        return hashlib.md5(xml_content.encode('utf-8')).hexdigest()
