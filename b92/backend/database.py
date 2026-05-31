from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Float, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./pdf_scanner.db")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class BatchScan(Base):
    __tablename__ = "batch_scans"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(255), unique=True, index=True)
    zip_filename = Column(String(255))
    zip_file_size = Column(Integer)
    total_files = Column(Integer, default=0)
    processed_files = Column(Integer, default=0)
    success_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    status = Column(String(20), default="PENDING")
    csv_report_path = Column(String(512))
    error_message = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime)
    completed_at = Column(DateTime)
    client_ip = Column(String(45))
    user_agent = Column(String(255))

    scan_results = relationship("BatchScanResult", back_populates="batch_scan")

class BatchScanResult(Base):
    __tablename__ = "batch_scan_results"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("batch_scans.id"))
    filename = Column(String(255))
    file_size = Column(Integer)
    file_hash = Column(String(64))
    risk_level = Column(String(20))
    risk_score = Column(Integer)
    total_scripts = Column(Integer, default=0)
    malicious_detections = Column(Integer, default=0)
    yara_matches = Column(Integer, default=0)
    success = Column(Boolean, default=True)
    error_message = Column(String(512))
    scan_result = Column(Text)
    scanned_at = Column(DateTime, default=datetime.utcnow)

    batch_scan = relationship("BatchScan", back_populates="scan_results")

class ScanHistory(Base):
    __tablename__ = "scan_history"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), index=True)
    file_size = Column(Integer)
    file_hash = Column(String(64), index=True)
    risk_level = Column(String(20))
    risk_score = Column(Integer)
    total_scripts = Column(Integer, default=0)
    malicious_detections = Column(Integer, default=0)
    yara_matches = Column(Integer, default=0)
    scan_result = Column(Text)
    scanned_at = Column(DateTime, default=datetime.utcnow)
    client_ip = Column(String(45))
    user_agent = Column(String(255))

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)
