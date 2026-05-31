from celery_app import celery
from database import SessionLocal, BatchScan, BatchScanResult
from datetime import datetime
import zipfile
import io
import os
import hashlib
import csv
import json
from pathlib import Path

MAX_PDF_PER_BATCH = int(os.getenv("MAX_PDF_PER_BATCH", "50"))
REPORT_DIR = os.getenv("REPORT_DIR", "./reports")

Path(REPORT_DIR).mkdir(parents=True, exist_ok=True)

def scan_single_pdf(pdf_data: bytes, filename: str) -> dict:
    try:
        import PyPDF2
        from io import BytesIO
        
        pdf_str = pdf_data.decode('utf-8', errors='ignore')
        if "/Encrypt" in pdf_str or "/EncryptName" in pdf_str:
            return {
                "success": False,
                "error": "ENCRYPTED_PDF: PDF文件已加密",
                "risk_level": "Unknown",
                "risk_score": 0
            }
        
        try:
            reader = PyPDF2.PdfReader(BytesIO(pdf_data))
        except Exception as e:
            err_str = str(e).lower()
            if "encrypt" in err_str or "password" in err_str or "crypt" in err_str:
                return {
                    "success": False,
                    "error": "ENCRYPTED_PDF: PDF文件已加密",
                    "risk_level": "Unknown",
                    "risk_score": 0
                }
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
            "success": True,
            "risk_level": risk_level,
            "risk_score": risk_score,
            "malicious_code_snippets": snippets,
            "extracted_scripts": scripts,
            "yara_matches": [],
            "summary": f"PDF扫描完成: 检测到 {len(scripts)} 个脚本, {len(snippets)} 个恶意模式"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "risk_level": "Error",
            "risk_score": 0
        }

def generate_csv_report(batch_id: int, db) -> str:
    batch = db.query(BatchScan).filter(BatchScan.id == batch_id).first()
    if not batch:
        return None
    
    results = db.query(BatchScanResult).filter(BatchScanResult.batch_id == batch_id).all()
    
    csv_filename = f"batch_{batch_id}_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    csv_path = os.path.join(REPORT_DIR, csv_filename)
    
    with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        writer.writerow([
            "序号", "文件名", "文件大小(KB)", "风险等级", "风险分数",
            "脚本数量", "恶意特征数量", "YARA匹配数", "扫描状态", "错误信息", "扫描时间"
        ])
        
        for idx, result in enumerate(results, 1):
            writer.writerow([
                idx,
                result.filename,
                round(result.file_size / 1024, 2) if result.file_size else 0,
                result.risk_level,
                result.risk_score,
                result.total_scripts,
                result.malicious_detections,
                result.yara_matches,
                "成功" if result.success else "失败",
                result.error_message or "",
                result.scanned_at.strftime("%Y-%m-%d %H:%M:%S")
            ])
    
    return csv_path

@celery.task(bind=True)
def process_batch_scan(self, batch_id: int, zip_data_bytes: list):
    db = SessionLocal()
    try:
        batch = db.query(BatchScan).filter(BatchScan.id == batch_id).first()
        if not batch:
            return {"error": "Batch not found"}
        
        batch.status = "PROCESSING"
        batch.started_at = datetime.utcnow()
        db.commit()
        
        zip_bytes = bytes(zip_data_bytes)
        zip_file = io.BytesIO(zip_bytes)
        
        success_count = 0
        failed_count = 0
        processed_count = 0
        
        with zipfile.ZipFile(zip_file, 'r') as zf:
            pdf_files = [f for f in zf.namelist() if f.lower().endswith('.pdf')]
            total_files = min(len(pdf_files), MAX_PDF_PER_BATCH)
            
            batch.total_files = total_files
            db.commit()
            
            for idx, pdf_path in enumerate(pdf_files[:MAX_PDF_PER_BATCH]):
                try:
                    with zf.open(pdf_path) as pdf_file:
                        pdf_data = pdf_file.read()
                    
                    file_size = len(pdf_data)
                    file_hash = hashlib.sha256(pdf_data).hexdigest()
                    
                    result = scan_single_pdf(pdf_data, os.path.basename(pdf_path))
                    
                    scan_result = BatchScanResult(
                        batch_id=batch_id,
                        filename=os.path.basename(pdf_path),
                        file_size=file_size,
                        file_hash=file_hash,
                        risk_level=result["risk_level"],
                        risk_score=result["risk_score"],
                        total_scripts=len(result.get("extracted_scripts", [])),
                        malicious_detections=len(result.get("malicious_code_snippets", [])),
                        yara_matches=len(result.get("yara_matches", [])),
                        success=result["success"],
                        error_message=result.get("error"),
                        scan_result=json.dumps(result, ensure_ascii=False)
                    )
                    
                    db.add(scan_result)
                    
                    if result["success"]:
                        success_count += 1
                    else:
                        failed_count += 1
                    
                    processed_count += 1
                    batch.processed_files = processed_count
                    batch.success_count = success_count
                    batch.failed_count = failed_count
                    db.commit()
                    
                    self.update_state(
                        state='PROGRESS',
                        meta={
                            'current': processed_count,
                            'total': total_files,
                            'success': success_count,
                            'failed': failed_count
                        }
                    )
                    
                except Exception as e:
                    failed_count += 1
                    processed_count += 1
                    
                    scan_result = BatchScanResult(
                        batch_id=batch_id,
                        filename=os.path.basename(pdf_path),
                        file_size=0,
                        file_hash="",
                        risk_level="Error",
                        risk_score=0,
                        success=False,
                        error_message=str(e)
                    )
                    
                    db.add(scan_result)
                    batch.processed_files = processed_count
                    batch.failed_count = failed_count
                    db.commit()
        
        csv_path = generate_csv_report(batch_id, db)
        
        batch.status = "COMPLETED"
        batch.completed_at = datetime.utcnow()
        batch.csv_report_path = csv_path
        db.commit()
        
        return {
            "status": "completed",
            "batch_id": batch_id,
            "total_files": total_files,
            "success_count": success_count,
            "failed_count": failed_count,
            "csv_report": csv_path
        }
        
    except Exception as e:
        batch.status = "FAILED"
        batch.error_message = str(e)
        batch.completed_at = datetime.utcnow()
        db.commit()
        return {
            "status": "failed",
            "error": str(e)
        }
    finally:
        db.close()
