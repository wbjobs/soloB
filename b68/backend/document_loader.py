from pathlib import Path
from typing import List, Dict, Any
from langchain_community.document_loaders import PyPDFLoader, TextLoader, DirectoryLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from config import settings

class DocumentProcessor:
    def __init__(self, chunk_size: int = None, chunk_overlap: int = None):
        self.chunk_size = chunk_size or settings.CHUNK_SIZE
        self.chunk_overlap = chunk_overlap or settings.CHUNK_OVERLAP
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            separators=["\n\n", "\n", ". ", " ", ""],
            length_function=len,
        )

    def load_single_file(self, file_path: str) -> List[Document]:
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        suffix = path.suffix.lower()
        
        if suffix == ".pdf":
            loader = PyPDFLoader(file_path)
        elif suffix in [".md", ".markdown"]:
            loader = TextLoader(file_path, encoding="utf-8")
        elif suffix == ".txt":
            loader = TextLoader(file_path, encoding="utf-8")
        else:
            raise ValueError(f"Unsupported file format: {suffix}")

        return loader.load()

    def load_directory(self, directory_path: str, glob_pattern: str = "**/*.{pdf,md,markdown,txt}") -> List[Document]:
        path = Path(directory_path)
        if not path.exists():
            raise FileNotFoundError(f"Directory not found: {directory_path}")

        loader = DirectoryLoader(
            directory_path,
            glob=glob_pattern,
            loader_cls=TextLoader,
            loader_kwargs={"encoding": "utf-8"},
            recursive=True,
            show_progress=True,
        )
        
        documents = []
        pdf_files = list(path.glob("**/*.pdf"))
        
        if pdf_files:
            for pdf_file in pdf_files:
                try:
                    pdf_loader = PyPDFLoader(str(pdf_file))
                    documents.extend(pdf_loader.load())
                except Exception as e:
                    print(f"Error loading PDF {pdf_file}: {e}")

        other_files = list(path.glob("**/*.{md,markdown,txt}"))
        for file in other_files:
            try:
                text_loader = TextLoader(str(file), encoding="utf-8")
                documents.extend(text_loader.load())
            except Exception as e:
                print(f"Error loading file {file}: {e}")

        return documents

    def split_documents(self, documents: List[Document]) -> List[Document]:
        return self.text_splitter.split_documents(documents)

    def process_file(self, file_path: str) -> List[Document]:
        documents = self.load_single_file(file_path)
        return self.split_documents(documents)

    def process_directory(self, directory_path: str) -> List[Document]:
        documents = self.load_directory(directory_path)
        return self.split_documents(documents)

    def convert_to_chroma_format(self, documents: List[Document]) -> Dict[str, List[Any]]:
        ids = []
        documents_text = []
        metadatas = []

        for i, doc in enumerate(documents):
            doc_id = f"doc_{i}_{Path(doc.metadata.get('source', '')).stem}"
            ids.append(doc_id)
            documents_text.append(doc.page_content)
            metadatas.append(doc.metadata)

        return {
            "ids": ids,
            "documents": documents_text,
            "metadatas": metadatas,
        }
