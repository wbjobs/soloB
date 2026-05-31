import os
import sys
import io
import json
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)
sys.path.insert(0, os.path.join(project_root, 'python'))

from python.worker import get_redis_connection, process_fit_task
from rq import Queue
from rq.job import Job


TASK_INPUT_KEY_PREFIX = "fit_task_input:"
TASK_INPUT_TTL = 86400


app = FastAPI(
    title="Nonlinear Curve Fitting Service",
    description="A microservice for nonlinear curve fitting using Levenberg-Marquardt algorithm",
    version="1.1.0"
)


def get_queue():
    redis_conn = get_redis_connection()
    return Queue('fit_tasks', connection=redis_conn)


def save_task_input(task_id: str, x: List[float], y: List[float], func_expression: str):
    try:
        redis_conn = get_redis_connection()
        task_data = {
            "x": x,
            "y": y,
            "func_expression": func_expression
        }
        redis_conn.setex(
            f"{TASK_INPUT_KEY_PREFIX}{task_id}",
            TASK_INPUT_TTL,
            json.dumps(task_data)
        )
    except:
        pass


def get_task_input(task_id: str) -> Optional[Dict[str, Any]]:
    try:
        redis_conn = get_redis_connection()
        data = redis_conn.get(f"{TASK_INPUT_KEY_PREFIX}{task_id}")
        if data:
            return json.loads(data)
    except:
        pass
    return None


def get_library_status_safe() -> Dict[str, Any]:
    try:
        from python.lm_wrapper import get_library_status
        return get_library_status()
    except Exception as e:
        return {
            "loaded": False,
            "path": None,
            "error": str(e)
        }


def generate_plot_png(
    x_data: List[float],
    y_data: List[float],
    fitted_params: List[float],
    func_expression: str,
    task_id: str
) -> bytes:
    try:
        import numpy as np
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        
        x_np = np.array(x_data)
        y_np = np.array(y_data)
        
        x_fit = np.linspace(min(x_data), max(x_data), 200)
        
        from python.lm_wrapper import LMWrapper
        wrapper = LMWrapper()
        
        try:
            y_fit = [wrapper.evaluate_function(x, fitted_params, func_expression) for x in x_fit]
        except:
            y_fit = None
        
        fig, ax = plt.subplots(figsize=(10, 6))
        
        ax.scatter(x_np, y_np, color='blue', label='Original Data', s=50, alpha=0.7)
        
        if y_fit is not None:
            ax.plot(x_fit, y_fit, color='red', linewidth=2.5, label='Fitted Curve')
        
        ax.set_xlabel('X', fontsize=12)
        ax.set_ylabel('Y', fontsize=12)
        ax.set_title(f'Curve Fitting Result\nTask: {task_id[:8]}...', fontsize=14, fontweight='bold')
        
        equation_display = func_expression
        param_text = ", ".join([f"p{i+1}={p:.4f}" for i, p in enumerate(fitted_params)])
        
        info_text = f"Function: {equation_display}\nParams: {param_text}"
        ax.text(0.02, 0.98, info_text, transform=ax.transAxes, 
                fontsize=10, verticalalignment='top', 
                bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
        
        ax.grid(True, linestyle='--', alpha=0.6)
        ax.legend(loc='best', fontsize=11)
        
        plt.tight_layout()
        
        buf = io.BytesIO()
        plt.savefig(buf, format='png', dpi=150, bbox_inches='tight')
        plt.close(fig)
        
        buf.seek(0)
        return buf.getvalue()
        
    except ImportError as e:
        raise RuntimeError(f"Missing plotting dependencies: {e}")
    except Exception as e:
        raise RuntimeError(f"Plot generation failed: {e}")


class FitRequest(BaseModel):
    x: List[float]
    y: List[float]
    func_expression: str
    initial_params: Optional[List[float]] = None


class FitResponse(BaseModel):
    task_id: str
    status: str
    message: str


class ResultResponse(BaseModel):
    task_id: str
    status: str
    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None


class StatusResponse(BaseModel):
    service: str
    version: str
    library_status: Dict[str, Any]


@app.get("/", response_model=StatusResponse)
async def root():
    return StatusResponse(
        service="Nonlinear Curve Fitting Service",
        version="1.1.0",
        library_status=get_library_status_safe()
    )


@app.post("/fit", response_model=FitResponse)
async def submit_fit_task(request: FitRequest):
    if len(request.x) != len(request.y):
        raise HTTPException(
            status_code=400,
            detail="x and y arrays must have the same length"
        )
    
    if len(request.x) < 3:
        raise HTTPException(
            status_code=400,
            detail="At least 3 data points are required"
        )
    
    if not request.func_expression:
        raise HTTPException(
            status_code=400,
            detail="Function expression is required"
        )
    
    try:
        queue = get_queue()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Redis connection failed: {e}"
        )
    
    job = queue.enqueue(
        process_fit_task,
        args=(request.x, request.y, request.func_expression, request.initial_params),
        job_timeout=300,
        result_ttl=86400,
        failure_ttl=86400
    )
    
    save_task_input(job.id, request.x, request.y, request.func_expression)
    
    return FitResponse(
        task_id=job.id,
        status="queued",
        message="Task has been queued successfully. Use /result/{task_id} to check status or /plot/{task_id} for visualization."
    )


@app.get("/result/{task_id}", response_model=ResultResponse)
async def get_fit_result(task_id: str):
    try:
        redis_conn = get_redis_connection()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Redis connection failed: {e}"
        )
    
    try:
        job = Job.fetch(task_id, connection=redis_conn)
    except Exception as e:
        raise HTTPException(
            status_code=404,
            detail=f"Task not found: {str(e)}"
        )
    
    response = ResultResponse(task_id=task_id, status=str(job.get_status()))
    
    if job.is_finished:
        result = job.result
        if result:
            response.result = result
            if result.get("status") == "failed":
                response.error_message = result.get("error_message", "Unknown error")
    elif job.is_failed:
        response.status = "failed"
        response.error_message = str(job.exc_info) if job.exc_info else "Task failed"
    elif job.is_queued:
        response.status = "queued"
    elif job.is_started:
        response.status = "processing"
    elif job.is_deferred:
        response.status = "deferred"
    elif job.is_scheduled:
        response.status = "scheduled"
    
    return response


@app.get("/plot/{task_id}")
async def get_plot(task_id: str):
    try:
        redis_conn = get_redis_connection()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Redis connection failed: {e}"
        )
    
    try:
        job = Job.fetch(task_id, connection=redis_conn)
    except Exception as e:
        raise HTTPException(
            status_code=404,
            detail=f"Task not found: {str(e)}"
        )
    
    job_status = job.get_status()
    
    if job_status == 'queued':
        raise HTTPException(
            status_code=425,
            detail="Task is still in queue. Please wait for processing to complete."
        )
    elif job_status == 'started':
        raise HTTPException(
            status_code=425,
            detail="Task is still processing. Please wait for completion."
        )
    elif job_status == 'deferred' or job_status == 'scheduled':
        raise HTTPException(
            status_code=425,
            detail="Task has not started yet."
        )
    elif job_status == 'failed':
        raise HTTPException(
            status_code=400,
            detail=f"Task failed: {job.exc_info if job.exc_info else 'Unknown error'}"
        )
    
    if not job.is_finished:
        raise HTTPException(
            status_code=400,
            detail=f"Task is in {job_status} state. Please wait for completion."
        )
    
    result = job.result
    if not result:
        raise HTTPException(
            status_code=404,
            detail="Task result not found"
        )
    
    if not result.get("success", False):
        raise HTTPException(
            status_code=400,
            detail=f"Fitting failed: {result.get('error_message', 'Unknown error')}"
        )
    
    fitted_params = result.get("params", [])
    if not fitted_params:
        raise HTTPException(
            status_code=400,
            detail="No fitted parameters found"
        )
    
    task_input = get_task_input(task_id)
    if not task_input:
        raise HTTPException(
            status_code=404,
            detail="Task input data not found. It may have expired or been deleted."
        )
    
    x_data = task_input.get("x", [])
    y_data = task_input.get("y", [])
    func_expression = task_input.get("func_expression", "")
    
    if not x_data or not y_data:
        raise HTTPException(
            status_code=404,
            detail="Task input data is incomplete"
        )
    
    try:
        png_data = generate_plot_png(
            x_data=x_data,
            y_data=y_data,
            fitted_params=fitted_params,
            func_expression=func_expression,
            task_id=task_id
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
    
    return StreamingResponse(
        io.BytesIO(png_data),
        media_type="image/png",
        headers={
            "Content-Disposition": f"inline; filename=fit_plot_{task_id[:8]}.png",
            "Cache-Control": "max-age=3600"
        }
    )


@app.get("/health")
async def health_check():
    redis_ok = False
    try:
        redis_conn = get_redis_connection()
        redis_conn.ping()
        redis_ok = True
    except:
        pass
    
    matplotlib_ok = False
    try:
        import matplotlib
        matplotlib_ok = True
    except:
        pass
    
    numpy_ok = False
    try:
        import numpy
        numpy_ok = True
    except:
        pass
    
    return {
        "status": "healthy" if redis_ok else "degraded",
        "timestamp": datetime.utcnow().isoformat(),
        "redis": redis_ok,
        "matplotlib": matplotlib_ok,
        "numpy": numpy_ok,
        "library": get_library_status_safe()
    }


@app.get("/library-status")
async def library_status():
    return get_library_status_safe()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
