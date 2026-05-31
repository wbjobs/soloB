from fastapi import FastAPI, File, UploadFile, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import json
import hashlib
import zipfile
import io
from datetime import datetime
from sqlalchemy.orm import Session
from database import get_db, init_db, ScanHistory, BatchScan, BatchScanResult
from tasks import process_batch_scan
import os
from dotenv import load_dotenv

load_dotenv()

MAX_PDF_PER_BATCH = int(os.getenv("MAX_PDF_PER_BATCH", "50"))
MAX_ZIP_SIZE = int(os.getenv("MAX_ZIP_SIZE", "104857600"))
REPORT_DIR = os.getenv("REPORT_DIR", "./reports")

os.makedirs(REPORT_DIR, exist_ok=True)

app = FastAPI(
    title="PDF Security Scanner API",
    description="PDF恶意软件扫描服务，支持单文件扫描和ZIP批量扫描（最多50个PDF）",
    version="1.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class MaliciousCode(BaseModel):
    code_type: str
    content: str
    description: str
    severity: str

class ExtractedScript(BaseModel):
    script_type: str
    content: str
    location: str

class YaraMatch(BaseModel):
    rule_name: str
    description: str
    matched_strings: List[str]
    severity: str

class ScanResultResponse(BaseModel):
    risk_level: str
    risk_score: int
    malicious_code_snippets: List[MaliciousCode]
    extracted_scripts: List[ExtractedScript]
    yara_matches: List[YaraMatch]
    summary: str
    scan_id: Optional[int] = None

class ScanHistoryResponse(BaseModel):
    id: int
    filename: str
    file_size: int
    file_hash: str
    risk_level: str
    risk_score: int
    total_scripts: int
    malicious_detections: int
    yara_matches: int
    scanned_at: datetime

class ScanStatisticsResponse(BaseModel):
    total_scans: int
    safe_count: int
    low_risk_count: int
    medium_risk_count: int
    high_risk_count: int
    critical_risk_count: int

class ScanErrorResponse(BaseModel):
    error_code: str
    error_message: str
    suggestion: str

class BatchScanResponse(BaseModel):
    task_id: str
    batch_id: int
    message: str
    total_files: int

class BatchStatusResponse(BaseModel):
    task_id: str
    batch_id: int
    status: str
    total_files: int
    processed_files: int
    success_count: int
    failed_count: int
    created_at: Optional[datetime]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    progress: Optional[float]
    csv_report_available: bool = False

class BatchResultItem(BaseModel):
    filename: str
    risk_level: str
    risk_score: int
    total_scripts: int
    malicious_detections: int
    yara_matches: int
    success: bool
    error_message: Optional[str]
    scanned_at: datetime

class BatchResultResponse(BaseModel):
    task_id: str
    batch_id: int
    status: str
    results: List[BatchResultItem]
    summary: dict

class PDFScanner:
    def __init__(self):
        self.initialized = False
    
    def initialize(self):
        if self.initialized:
            return
        try:
            from wasmer import Module, Instance, Store, ImportObject, Function, FunctionType, Type, Memory
            from wasmer_compiler_cranelift import Compiler
            
            wasm_path = os.getenv("WASM_MODULE_PATH", "../pkg/pdf_security_scanner_bg.wasm")
            
            if os.path.exists(wasm_path):
                store = Store(Compiler)
                module = Module(store, open(wasm_path, 'rb').read())
                import_object = ImportObject()
                
                memory = Memory(store, 18, None)
                import_object.register("env", {"memory": memory})
                
                self.instance = Instance(module, import_object)
                self.initialized = True
                print("WASM module loaded successfully")
            else:
                print(f"WASM module not found at {wasm_path}")
                self.initialized = False
        except Exception as e:
            print(f"Failed to load WASM module: {e}")
            self.initialized = False
    
    def scan_pdf(self, pdf_data: bytes) -> dict:
        if not self.initialized:
            return self._fallback_scan(pdf_data)
        
        try:
            pass
        except Exception as e:
            print(f"WASM scan failed: {e}")
            return self._fallback_scan(pdf_data)
    
    def _fallback_scan(self, pdf_data: bytes) -> dict:
        try:
            import PyPDF2
            from io import BytesIO
            
            pdf_str = pdf_data.decode('utf-8', errors='ignore')
            if "/Encrypt" in pdf_str or "/EncryptName" in pdf_str:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error_code": "ENCRYPTED_PDF",
                        "error_message": "PDF文件已加密，需要密码才能解析",
                        "suggestion": "请上传解密后的PDF文件，或提供正确的密码后重新扫描"
                    }
                )
            
            try:
                reader = PyPDF2.PdfReader(BytesIO(pdf_data))
            except Exception as e:
                err_str = str(e).lower()
                if "encrypt" in err_str or "password" in err_str or "crypt" in err_str:
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "error_code": "ENCRYPTED_PDF",
                            "error_message": "PDF文件已加密，需要密码才能解析",
                            "suggestion": "请上传解密后的PDF文件，或提供正确的密码后重新扫描"
                        }
                    )
                raise
            
            scripts = []
            
            if "/JS" in str(reader.trailer):
                scripts.append({
                    "script_type": "JavaScript",
                    "content": str(reader.trailer),
                    "location": "Trailer"
                })
            
            risk_score = 0
            snippets = []
            
            pdf_text = str(reader.trailer)
            for page in reader.pages:
                try:
                    pdf_text += str(page.get_contents())
                except:
                    pass
            
            suspicious_patterns = [
                ("OpenAction", "检测到自动打开动作", 20, "Medium"),
                ("/JS", "检测到JavaScript", 25, "High"),
                ("/JavaScript", "检测到JavaScript", 25, "High"),
                ("Launch", "检测到启动动作", 35, "High"),
                ("cmd.exe", "检测到命令行执行", 45, "Critical"),
                ("powershell", "检测到PowerShell执行", 45, "Critical"),
            ]
            
            for pattern, desc, score, severity in suspicious_patterns:
                if pattern in pdf_text:
                    risk_score += score
                    snippets.append({
                        "code_type": pattern,
                        "content": pattern,
                        "description": desc,
                        "severity": severity
                    })
            
            risk_score = min(risk_score, 100)
            
            if risk_score == 0:
                risk_level = "Safe"
            elif risk_score <= 30:
                risk_level = "Low"
            elif risk_score <= 60:
                risk_level = "Medium"
            elif risk_score <= 85:
                risk_level = "High"
            else:
                risk_level = "Critical"
            
            return {
                "risk_level": risk_level,
                "risk_score": risk_score,
                "malicious_code_snippets": snippets,
                "extracted_scripts": scripts,
                "yara_matches": [],
                "summary": f"PDF扫描完成: 检测到 {len(scripts)} 个脚本, {len(snippets)} 个恶意模式. 风险等级: {risk_level}, 风险分数: {risk_score}"
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"PDF扫描失败: {str(e)}")

scanner = PDFScanner()

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    from fastapi.responses import JSONResponse
    
    if isinstance(exc.detail, dict) and "error_code" in exc.detail:
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.detail
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail}
    )

@app.on_event("startup")
async def startup_event():
    init_db()
    scanner.initialize()

@app.get("/")
async def root():
    return {"message": "PDF Security Scanner API", "version": "1.0.0"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "wasm_loaded": scanner.initialized}

@app.post("/api/scan", response_model=ScanResultResponse, responses={400: {"model": ScanErrorResponse}})
async def scan_pdf(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="只支持PDF文件")
    
    pdf_data = await file.read()
    file_size = len(pdf_data)
    file_hash = hashlib.sha256(pdf_data).hexdigest()
    
    if file_size > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小不能超过50MB")
    
    try:
        result = scanner.scan_pdf(pdf_data)
    except Exception as e:
        err_str = str(e)
        if "ENCRYPTED_PDF" in err_str:
            try:
                error_details = json.loads(err_str)
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error_code": error_details.get("error_code", "ENCRYPTED_PDF"),
                        "error_message": error_details.get("error_message", "PDF文件已加密，需要密码才能解析"),
                        "suggestion": error_details.get("suggestion", "请上传解密后的PDF文件，或提供正确的密码后重新扫描")
                    }
                )
            except:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error_code": "ENCRYPTED_PDF",
                        "error_message": "PDF文件已加密，需要密码才能解析",
                        "suggestion": "请上传解密后的PDF文件，或提供正确的密码后重新扫描"
                    }
                )
        raise
    
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    
    scan_record = ScanHistory(
        filename=file.filename,
        file_size=file_size,
        file_hash=file_hash,
        risk_level=result["risk_level"],
        risk_score=result["risk_score"],
        total_scripts=len(result["extracted_scripts"]),
        malicious_detections=len(result["malicious_code_snippets"]),
        yara_matches=len(result["yara_matches"]),
        scan_result=json.dumps(result, ensure_ascii=False),
        client_ip=client_ip,
        user_agent=user_agent
    )
    
    db.add(scan_record)
    db.commit()
    db.refresh(scan_record)
    
    result["scan_id"] = scan_record.id
    return result

@app.get("/api/history", response_model=List[ScanHistoryResponse])
async def get_scan_history(
    skip: int = 0,
    limit: int = 100,
    risk_level: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(ScanHistory)
    
    if risk_level:
        query = query.filter(ScanHistory.risk_level == risk_level)
    
    history = query.order_by(ScanHistory.scanned_at.desc()).offset(skip).limit(limit).all()
    return history

@app.get("/api/history/{scan_id}", response_model=ScanResultResponse)
async def get_scan_detail(scan_id: int, db: Session = Depends(get_db)):
    scan = db.query(ScanHistory).filter(ScanHistory.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="扫描记录不存在")
    
    result = json.loads(scan.scan_result)
    result["scan_id"] = scan.id
    return result

@app.get("/api/statistics", response_model=ScanStatisticsResponse)
async def get_statistics(db: Session = Depends(get_db)):
    total = db.query(ScanHistory).count()
    safe = db.query(ScanHistory).filter(ScanHistory.risk_level == "Safe").count()
    low = db.query(ScanHistory).filter(ScanHistory.risk_level == "Low").count()
    medium = db.query(ScanHistory).filter(ScanHistory.risk_level == "Medium").count()
    high = db.query(ScanHistory).filter(ScanHistory.risk_level == "High").count()
    critical = db.query(ScanHistory).filter(ScanHistory.risk_level == "Critical").count()
    
    return {
        "total_scans": total,
        "safe_count": safe,
        "low_risk_count": low,
        "medium_risk_count": medium,
        "high_risk_count": high,
        "critical_risk_count": critical
    }

@app.post("/api/batch/scan", response_model=BatchScanResponse)
async def batch_scan(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    if not file.filename.lower().endswith('.zip'):
        raise HTTPException(status_code=400, detail="只支持ZIP文件")
    
    zip_data = await file.read()
    zip_size = len(zip_data)
    
    if zip_size > MAX_ZIP_SIZE:
        raise HTTPException(status_code=400, detail=f"ZIP文件大小不能超过{MAX_ZIP_SIZE // 1024 // 1024}MB")
    
    try:
        zip_file = io.BytesIO(zip_data)
        with zipfile.ZipFile(zip_file, 'r') as zf:
            pdf_files = [f for f in zf.namelist() if f.lower().endswith('.pdf')]
            
            if len(pdf_files) == 0:
                raise HTTPException(status_code=400, detail="ZIP文件中没有找到PDF文件")
            
            if len(pdf_files) > MAX_PDF_PER_BATCH:
                raise HTTPException(
                    status_code=400,
                    detail=f"ZIP文件中最多只能包含{MAX_PDF_PER_BATCH}个PDF文件，当前有{len(pdf_files)}个"
                )
            
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="无效的ZIP文件")
    
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    
    batch_scan = BatchScan(
        zip_filename=file.filename,
        zip_file_size=zip_size,
        total_files=len(pdf_files),
        client_ip=client_ip,
        user_agent=user_agent
    )
    
    db.add(batch_scan)
    db.commit()
    db.refresh(batch_scan)
    
    task = process_batch_scan.delay(batch_scan.id, list(zip_data))
    
    batch_scan.task_id = task.id
    db.commit()
    
    return {
        "task_id": task.id,
        "batch_id": batch_scan.id,
        "message": f"批量扫描任务已创建，共{len(pdf_files)}个PDF文件将被处理",
        "total_files": len(pdf_files)
    }

@app.get("/api/batch/status/{task_id}", response_model=BatchStatusResponse)
async def get_batch_status(task_id: str, db: Session = Depends(get_db)):
    batch = db.query(BatchScan).filter(BatchScan.task_id == task_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    from celery.result import AsyncResult
    from celery_app import celery
    
    task_result = AsyncResult(task_id, app=celery)
    
    progress = None
    if task_result.state == 'PROGRESS':
        meta = task_result.info
        if meta and 'total' in meta and meta['total'] > 0:
            progress = (meta['current'] / meta['total']) * 100
    
    return {
        "task_id": task_id,
        "batch_id": batch.id,
        "status": task_result.state,
        "total_files": batch.total_files,
        "processed_files": batch.processed_files,
        "success_count": batch.success_count,
        "failed_count": batch.failed_count,
        "created_at": batch.created_at,
        "started_at": batch.started_at,
        "completed_at": batch.completed_at,
        "progress": progress,
        "csv_report_available": batch.csv_report_path is not None
    }

@app.get("/api/batch/result/{task_id}", response_model=BatchResultResponse)
async def get_batch_result(task_id: str, db: Session = Depends(get_db)):
    batch = db.query(BatchScan).filter(BatchScan.task_id == task_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    from celery.result import AsyncResult
    from celery_app import celery
    
    task_result = AsyncResult(task_id, app=celery)
    
    if not task_result.ready():
        raise HTTPException(status_code=400, detail="任务尚未完成，请稍后再试")
    
    results = db.query(BatchScanResult).filter(BatchScanResult.batch_id == batch.id).all()
    
    result_items = []
    for r in results:
        result_items.append({
            "filename": r.filename,
            "risk_level": r.risk_level,
            "risk_score": r.risk_score,
            "total_scripts": r.total_scripts,
            "malicious_detections": r.malicious_detections,
            "yara_matches": r.yara_matches,
            "success": r.success,
            "error_message": r.error_message,
            "scanned_at": r.scanned_at
        })
    
    summary = {
        "total": batch.total_files,
        "processed": batch.processed_files,
        "success": batch.success_count,
        "failed": batch.failed_count,
        "safe": sum(1 for r in results if r.risk_level == "Safe"),
        "low": sum(1 for r in results if r.risk_level == "Low"),
        "medium": sum(1 for r in results if r.risk_level == "Medium"),
        "high": sum(1 for r in results if r.risk_level == "High"),
        "critical": sum(1 for r in results if r.risk_level == "Critical")
    }
    
    return {
        "task_id": task_id,
        "batch_id": batch.id,
        "status": task_result.state,
        "results": result_items,
        "summary": summary
    }

@app.get("/api/batch/report/{task_id}")
async def download_batch_report(task_id: str, db: Session = Depends(get_db)):
    batch = db.query(BatchScan).filter(BatchScan.task_id == task_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    if not batch.csv_report_path or not os.path.exists(batch.csv_report_path):
        raise HTTPException(status_code=404, detail="报告文件不存在")
    
    filename = os.path.basename(batch.csv_report_path)
    return FileResponse(
        path=batch.csv_report_path,
        filename=filename,
        media_type="text/csv"
    )

@app.get("/api/batch/history", response_model=List[BatchStatusResponse])
async def get_batch_history(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    batches = db.query(BatchScan).order_by(BatchScan.created_at.desc()).offset(skip).limit(limit).all()
    
    results = []
    for batch in batches:
        results.append({
            "task_id": batch.task_id,
            "batch_id": batch.id,
            "status": batch.status,
            "total_files": batch.total_files,
            "processed_files": batch.processed_files,
            "success_count": batch.success_count,
            "failed_count": batch.failed_count,
            "created_at": batch.created_at,
            "started_at": batch.started_at,
            "completed_at": batch.completed_at,
            "progress": None,
            "csv_report_available": batch.csv_report_path is not None and os.path.exists(batch.csv_report_path)
        })
    
    return results

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
