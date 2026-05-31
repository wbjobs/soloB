from fastapi import APIRouter, HTTPException, UploadFile, File
from typing import Dict, Any
from pydantic import BaseModel
from ..core.xml_parser import XMLParser
from ..core.code_generator import CodeGenerator
from ..core.cache import Cache
from ..core.simulator import Simulator
from ..core.reverse_generator import ReverseGenerator, python_to_ladder_xml
from ..models.plc_models import (
    CompileRequest,
    CompileResponse,
    SimulateRequest,
    SimulateResponse
)

router = APIRouter(prefix="/api", tags=["PLC"])
parser = XMLParser()
generator = CodeGenerator()
cache = Cache()
simulator = Simulator()
reverse_gen = ReverseGenerator()


class ReverseGenerateRequest(BaseModel):
    python_code: str
    program_name: str = "PLC Program (Reverse Engineered)"


class ReverseGenerateResponse(BaseModel):
    program_name: str
    xml_content: str
    analysis: Dict[str, Any]


@router.post("/compile", response_model=CompileResponse)
async def compile_program(request: CompileRequest):
    try:
        cache_key = XMLParser.generate_cache_key(request.xml_content)
        
        cached = cache.get_compiled_program(cache_key)
        if cached:
            return CompileResponse(
                program_name=cached['program_name'],
                python_code=cached['python_code'],
                cache_key=cache_key
            )
        
        program = parser.parse(request.xml_content)
        python_code = generator.generate(program)
        
        cache.save_compiled_program(
            cache_key=cache_key,
            program_name=program.name,
            xml_content=request.xml_content,
            python_code=python_code
        )
        
        return CompileResponse(
            program_name=program.name,
            python_code=python_code,
            cache_key=cache_key
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Compilation error: {str(e)}")


@router.post("/compile/upload")
async def compile_upload(file: UploadFile = File(...)):
    try:
        content = await file.read()
        xml_content = content.decode('utf-8')
        
        cache_key = XMLParser.generate_cache_key(xml_content)
        
        cached = cache.get_compiled_program(cache_key)
        if cached:
            return {
                "program_name": cached['program_name'],
                "python_code": cached['python_code'],
                "cache_key": cache_key,
                "from_cache": True
            }
        
        program = parser.parse(xml_content)
        python_code = generator.generate(program)
        
        cache.save_compiled_program(
            cache_key=cache_key,
            program_name=program.name,
            xml_content=xml_content,
            python_code=python_code
        )
        
        return {
            "program_name": program.name,
            "python_code": python_code,
            "cache_key": cache_key,
            "from_cache": False
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Upload error: {str(e)}")


@router.post("/simulate", response_model=SimulateResponse)
async def simulate_program(request: SimulateRequest):
    try:
        cached = cache.get_compiled_program(request.cache_key)
        if not cached:
            raise HTTPException(status_code=404, detail="Program not found in cache")
        
        python_code = cached['python_code']
        program_name = cached['program_name']
        
        if not simulator.load_code(python_code):
            raise HTTPException(status_code=500, detail="Failed to load generated code")
        
        result = simulator.execute(
            cycles=request.cycles,
            inputs=request.initial_inputs,
            program_name=program_name
        )
        
        cache.save_execution_result(
            cache_key=request.cache_key,
            cycles=request.cycles,
            initial_inputs=request.initial_inputs,
            result=result['raw_result']
        )
        
        return SimulateResponse(
            program_name=program_name,
            execution_log=result['execution_log'],
            final_state=result['final_state']
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulation error: {str(e)}")


@router.get("/program/{cache_key}")
async def get_program(cache_key: str):
    try:
        cached = cache.get_compiled_program(cache_key)
        if not cached:
            raise HTTPException(status_code=404, detail="Program not found in cache")
        
        return {
            "program_name": cached['program_name'],
            "python_code": cached['python_code'],
            "created_at": cached['created_at']
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/program/{cache_key}/history")
async def get_execution_history(cache_key: str, limit: int = 10):
    try:
        history = cache.get_execution_history(cache_key, limit)
        return {"history": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/cache/cleanup")
async def cleanup_cache(days: int = 30):
    try:
        deleted = cache.clear_old_entries(days)
        return {"deleted_entries": deleted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reverse-generate", response_model=ReverseGenerateResponse)
async def reverse_generate(request: ReverseGenerateRequest):
    try:
        xml_content, analysis = python_to_ladder_xml(
            request.python_code,
            request.program_name
        )
        
        return ReverseGenerateResponse(
            program_name=request.program_name,
            xml_content=xml_content,
            analysis={
                'inputs': analysis['inputs'],
                'outputs': analysis['outputs'],
                'timers': analysis['timers'],
                'counters': analysis['counters'],
                'rung_count': len(analysis['rungs'])
            }
        )
    except SyntaxError as e:
        raise HTTPException(status_code=400, detail=f"Python syntax error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reverse generation error: {str(e)}")


@router.post("/round-trip")
async def round_trip_test(request: CompileRequest):
    try:
        program = parser.parse(request.xml_content)
        python_code = generator.generate(program)
        
        regenerated_xml, analysis = python_to_ladder_xml(
            python_code,
            f"Round Trip: {program.name}"
        )
        
        return {
            'original_program': program.name,
            'generated_python_code': python_code,
            'regenerated_xml': regenerated_xml,
            'analysis': {
                'inputs': analysis['inputs'],
                'outputs': analysis['outputs'],
                'rung_count': len(analysis['rungs'])
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Round trip error: {str(e)}")
