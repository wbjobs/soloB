import logging
import uuid
from dataclasses import dataclass
from io import BytesIO
from typing import List, Tuple, Optional, Dict, Any

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from pypdf import PdfReader

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False
    logger.warning("pdfplumber not installed. Table extraction will be limited.")


@dataclass
class PageContent:
    page_number: int
    text: str
    tables: List[List[List[Optional[str]]]]
    table_bboxes: List[Tuple[float, float, float, float]]


class TableExtractor:
    @staticmethod
    def table_to_markdown(table: List[List[Optional[str]]]) -> str:
        if not table or not table[0]:
            return ""
        
        def clean_cell(cell: Optional[str]) -> str:
            if cell is None:
                return ""
            return str(cell).strip().replace("\n", " ").replace("|", "\\|")
        
        cleaned_rows = [
            [clean_cell(cell) for cell in row]
            for row in table
        ]
        
        if not cleaned_rows:
            return ""
        
        header_row = cleaned_rows[0]
        num_cols = max(len(row) for row in cleaned_rows)
        
        padded_header = header_row + [""] * (num_cols - len(header_row))
        separator_row = ["---"] * num_cols
        
        padded_rows = [
            row + [""] * (num_cols - len(row))
            for row in cleaned_rows[1:]
        ]
        
        lines = []
        lines.append("| " + " | ".join(padded_header) + " |")
        lines.append("| " + " | ".join(separator_row) + " |")
        for row in padded_rows:
            lines.append("| " + " | ".join(row) + " |")
        
        return "\n".join(lines)

    @staticmethod
    def summarize_table(table: List[List[Optional[str]]], max_chars: int = 500) -> str:
        if not table:
            return ""
        
        headers = [str(h).strip() if h else "" for h in table[0]]
        headers = [h for h in headers if h]
        
        summary_parts = []
        if headers:
            summary_parts.append(f"Columns: {', '.join(headers[:5])}")
            if len(headers) > 5:
                summary_parts[-1] += f" (+{len(headers) - 5} more)"
        
        num_rows = len(table) - 1
        if num_rows > 0:
            summary_parts.append(f"Data rows: {num_rows}")
        
        return " | ".join(summary_parts)

    @staticmethod
    def is_valid_table(table: List[List[Optional[str]]]) -> bool:
        if not table or len(table) < 2:
            return False
        
        total_cells = 0
        non_empty_cells = 0
        
        for row in table:
            for cell in row:
                total_cells += 1
                if cell and str(cell).strip():
                    non_empty_cells += 1
        
        if total_cells == 0:
            return False
        
        density = non_empty_cells / total_cells
        return density >= 0.2


class SmartTextExtractor:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.table_extractor = TableExtractor()

    def extract_with_pypdf(self, pdf_bytes: bytes) -> List[PageContent]:
        logger.info("Extracting text using PyPDF (fallback)")
        pdf_file = BytesIO(pdf_bytes)
        reader = PdfReader(pdf_file)
        
        pages = []
        for page_num, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            pages.append(PageContent(
                page_number=page_num,
                text=text,
                tables=[],
                table_bboxes=[]
            ))
        
        return pages

    def extract_with_pdfplumber(self, pdf_bytes: bytes) -> List[PageContent]:
        if not PDFPLUMBER_AVAILABLE:
            return self.extract_with_pypdf(pdf_bytes)
        
        logger.info("Extracting text and tables using pdfplumber")
        pdf_file = BytesIO(pdf_bytes)
        
        try:
            with pdfplumber.open(pdf_file) as pdf:
                pages = []
                
                for page_num, page in enumerate(pdf.pages, start=1):
                    tables = page.extract_tables() or []
                    table_bboxes = []
                    
                    for table in tables:
                        if self.table_extractor.is_valid_table(table):
                            try:
                                bbox = page.find_tables()[len(table_bboxes)].bbox
                                table_bboxes.append(bbox)
                            except Exception:
                                table_bboxes.append((0, 0, 0, 0))
                        else:
                            table_bboxes.append((0, 0, 0, 0))
                    
                    valid_tables = [
                        t for t, b in zip(tables, table_bboxes)
                        if b != (0, 0, 0, 0)
                    ]
                    valid_bboxes = [b for b in table_bboxes if b != (0, 0, 0, 0)]
                    
                    text = page.extract_text() or ""
                    
                    pages.append(PageContent(
                        page_number=page_num,
                        text=text,
                        tables=valid_tables,
                        table_bboxes=valid_bboxes
                    ))
                
                total_tables = sum(len(p.tables) for p in pages)
                logger.info(f"Extracted {len(pages)} pages with {total_tables} tables")
                return pages
                
        except Exception as e:
            logger.warning(f"pdfplumber extraction failed: {e}. Falling back to PyPDF.")
            return self.extract_with_pypdf(pdf_bytes)

    def generate_structured_content(self, page: PageContent) -> str:
        content_parts = [f"[Page {page.page_number}]"]
        
        if page.tables and PDFPLUMBER_AVAILABLE:
            tables_markdown = []
            for idx, table in enumerate(page.tables, 1):
                if self.table_extractor.is_valid_table(table):
                    md_table = self.table_extractor.table_to_markdown(table)
                    summary = self.table_extractor.summarize_table(table)
                    
                    table_block = f"\n## Table {idx} ({page.page_number})\n"
                    table_block += f"Summary: {summary}\n\n"
                    table_block += "```markdown\n"
                    table_block += md_table
                    table_block += "\n```\n"
                    
                    tables_markdown.append(table_block)
            
            if tables_markdown:
                content_parts.append("\n".join(tables_markdown))
        
        if page.text.strip():
            content_parts.append(page.text)
        
        return "\n\n".join(content_parts)


class TableAwareTextSplitter:
    def __init__(self, chunk_size: int, chunk_overlap: int):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        
        self._table_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
            separators=["\n\n## Table ", "\n\n", "\n", " ", ""]
        )
        
        self._regular_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
            separators=["\n\n[Page ", "\n\n", "\n", " ", ""]
        )

    def split_text(self, text: str) -> List[str]:
        table_marker = "## Table "
        
        if table_marker not in text:
            return self._regular_splitter.split_text(text)
        
        pre_tables, tables_section = self._split_at_first_table(text)
        
        chunks = []
        
        if pre_tables.strip():
            pre_chunks = self._regular_splitter.split_text(pre_tables)
            chunks.extend(pre_chunks)
        
        if tables_section.strip():
            table_chunks = self._split_tables_preserving_structure(tables_section)
            chunks.extend(table_chunks)
        
        return self._merge_small_chunks(chunks)

    def _split_at_first_table(self, text: str) -> Tuple[str, str]:
        table_marker = "## Table "
        idx = text.find(table_marker)
        
        if idx == -1:
            return text, ""
        
        return text[:idx], text[idx:]

    def _split_tables_preserving_structure(self, text: str) -> List[str]:
        table_blocks = self._extract_table_blocks(text)
        
        if not table_blocks:
            return self._table_splitter.split_text(text)
        
        chunks = []
        current_chunk = ""
        
        for block in table_blocks:
            block_size = len(block)
            
            if len(current_chunk) + block_size <= self.chunk_size:
                current_chunk += ("\n\n" if current_chunk else "") + block
            else:
                if current_chunk:
                    chunks.append(current_chunk)
                
                if block_size <= self.chunk_size:
                    current_chunk = block
                else:
                    sub_chunks = self._table_splitter.split_text(block)
                    chunks.extend(sub_chunks)
                    current_chunk = ""
        
        if current_chunk:
            chunks.append(current_chunk)
        
        return chunks

    def _extract_table_blocks(self, text: str) -> List[str]:
        blocks = []
        lines = text.split("\n")
        current_block = []
        
        for line in lines:
            if line.startswith("## Table "):
                if current_block:
                    blocks.append("\n".join(current_block).strip())
                    current_block = []
            current_block.append(line)
        
        if current_block:
            blocks.append("\n".join(current_block).strip())
        
        return blocks

    def _merge_small_chunks(self, chunks: List[str], min_ratio: float = 0.5) -> List[str]:
        if len(chunks) <= 1:
            return chunks
        
        min_size = int(self.chunk_size * min_ratio)
        merged = []
        current = ""
        
        for chunk in chunks:
            if len(current) + len(chunk) <= self.chunk_size:
                current += ("\n\n" if current else "") + chunk
            else:
                if len(current) >= min_size:
                    merged.append(current)
                    current = chunk
                elif current:
                    merged.append(current + "\n\n" + chunk)
                    current = ""
                else:
                    merged.append(chunk)
        
        if current:
            merged.append(current)
        
        return merged


class DocumentProcessor:
    def __init__(self, settings: Settings = None):
        self.settings = settings or get_settings()
        self.extractor = SmartTextExtractor(self.settings)
        self.splitter = TableAwareTextSplitter(
            chunk_size=self.settings.text_chunk_size,
            chunk_overlap=self.settings.text_chunk_overlap
        )

    def process_pdf(self, pdf_bytes: bytes, filename: str = "document.pdf") -> List[Document]:
        logger.info(f"Processing PDF: {filename}")
        
        try:
            pages = self.extractor.extract_with_pdfplumber(pdf_bytes)
            
            if not pages:
                logger.warning(f"No content extracted from {filename}")
                return []
            
            total_tables = sum(len(p.tables) for p in pages)
            logger.info(f"Extracted {len(pages)} pages, {total_tables} tables total")
            
            structured_text = "\n\n".join(
                self.extractor.generate_structured_content(page)
                for page in pages
            )
            
            if not structured_text.strip():
                logger.warning(f"No meaningful text extracted from {filename}")
                return []
            
            metadata = {
                "source": filename,
                "document_id": str(uuid.uuid4()),
                "total_pages": len(pages),
                "total_tables": total_tables,
                "total_characters": len(structured_text),
                "extractor": "pdfplumber" if PDFPLUMBER_AVAILABLE else "pypdf"
            }
            
            chunks = self.split_text_into_chunks(structured_text, metadata)
            
            logger.info(f"Successfully processed {filename}: {len(chunks)} chunks created")
            return chunks
            
        except Exception as e:
            logger.error(f"Error processing PDF {filename}: {e}")
            raise

    def split_text_into_chunks(self, text: str, metadata: dict = None) -> List[Document]:
        logger.info(f"Splitting text into chunks (chunk_size={self.settings.text_chunk_size})")
        
        base_metadata = metadata or {}
        chunk_texts = self.splitter.split_text(text)
        
        documents = []
        for i, chunk_text in enumerate(chunk_texts):
            chunk_metadata = dict(base_metadata)
            chunk_metadata.update({
                "chunk_id": str(uuid.uuid4()),
                "chunk_index": i,
                "chunk_size": len(chunk_text),
                "is_table_chunk": "## Table" in chunk_text
            })
            documents.append(Document(page_content=chunk_text, metadata=chunk_metadata))
        
        logger.info(f"Created {len(documents)} text chunks")
        
        table_chunks = sum(1 for d in documents if d.metadata.get("is_table_chunk"))
        if table_chunks > 0:
            logger.info(f"Table-aware chunks: {table_chunks}")
        
        return documents

    def process_pdfs_batch(self, pdf_files: List[bytes], filenames: List[str]) -> List[Document]:
        logger.info(f"Processing batch of {len(pdf_files)} PDFs")
        
        all_chunks = []
        for pdf_bytes, filename in zip(pdf_files, filenames):
            try:
                chunks = self.process_pdf(pdf_bytes, filename)
                all_chunks.extend(chunks)
            except Exception as e:
                logger.error(f"Skipping {filename} due to error: {e}")
        
        logger.info(f"Batch processing complete: {len(all_chunks)} total chunks")
        return all_chunks

    @staticmethod
    def extract_text_from_pdf(pdf_bytes: bytes) -> str:
        logger.warning("extract_text_from_pdf is deprecated. Use process_pdf instead.")
        settings = get_settings()
        extractor = SmartTextExtractor(settings)
        pages = extractor.extract_with_pdfplumber(pdf_bytes)
        return "\n\n".join(page.text for page in pages)
