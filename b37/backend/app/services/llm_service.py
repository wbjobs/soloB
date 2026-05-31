import logging
from typing import List, Optional

from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

TABLE_AWARE_SYSTEM_PROMPT = """You are a precise assistant that answers questions based SOLELY on the provided context.

CRITICAL INSTRUCTIONS:
1. ONLY use information from the provided context. Never make up information.
2. If the answer is not in the context, say exactly: "I don't have enough information to answer this question."
3. Pay SPECIAL ATTENTION to tables formatted in Markdown. They contain structured data.
4. For questions about numerical data, statistics, or comparisons, ALWAYS look for tables first.
5. When using table data:
   - Reference the specific table number
   - Quote exact values from the table
   - Do calculations only if the numbers are clearly present
6. If multiple tables contain relevant information, synthesize them but be clear about sources.
7. Use Markdown formatting in your answer (lists, tables, bold for emphasis).
8. Include brief citations like [Table X, Page Y] when referencing table data.

Context will contain:
- Regular text paragraphs
- Tables in Markdown format, marked with "## Table N (Page X)"
- Table summaries showing columns and row counts

REMEMBER: If you're not certain about data from a table, don't guess. State that the specific information isn't clear in the provided tables.

---

Context:
{context}

---

Question: {question}

Answer:"""


class ContextFormatter:
    @staticmethod
    def detect_table_content(doc: Document) -> bool:
        return "## Table" in doc.page_content or doc.metadata.get("is_table_chunk", False)

    @staticmethod
    def format_single_document(doc: Document, index: int) -> str:
        source = doc.metadata.get("source", "Unknown")
        chunk_index = doc.metadata.get("chunk_index", index)
        page_info = ""
        
        if "total_pages" in doc.metadata:
            page_info = f" | Pages: {doc.metadata.get('total_pages')}"
        
        has_table = ContextFormatter.detect_table_content(doc)
        table_tag = " [CONTAINS TABLES]" if has_table else ""
        
        header = f"[Document {index}] Source: {source} | Chunk: {chunk_index}{page_info}{table_tag}"
        content = doc.page_content
        
        return f"{header}\n\n{content}"

    @staticmethod
    def prioritize_tables(documents: List[Document]) -> List[Document]:
        table_docs = [d for d in documents if ContextFormatter.detect_table_content(d)]
        regular_docs = [d for d in documents if not ContextFormatter.detect_table_content(d)]
        
        logger.info(f"Context contains {len(table_docs)} table chunks, {len(regular_docs)} regular chunks")
        
        return table_docs + regular_docs


class LLMService:
    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self._llm = None
        self._chain = None
        self.context_formatter = ContextFormatter()

    def _get_ollama_llm(self):
        from langchain_community.chat_models import ChatOllama
        
        return ChatOllama(
            model=self.settings.llm_model_name,
            base_url=self.settings.llm_api_url,
            temperature=0.1,
            num_ctx=8192,
        )

    def _get_openai_llm(self):
        from langchain_openai import ChatOpenAI
        
        return ChatOpenAI(
            model=self.settings.llm_model_name,
            api_key=self.settings.llm_api_key,
            base_url=self.settings.llm_api_url,
            temperature=0.1,
        )

    @property
    def llm(self):
        if self._llm is None:
            provider = self.settings.llm_provider.lower()
            
            logger.info(f"Initializing LLM with provider: {provider}, model: {self.settings.llm_model_name}")
            
            if provider == "ollama":
                self._llm = self._get_ollama_llm()
            elif provider in ["openai", "qwen"]:
                self._llm = self._get_openai_llm()
            else:
                raise ValueError(f"Unsupported LLM provider: {provider}")
        
        return self._llm

    @property
    def chain(self):
        if self._chain is None:
            prompt = ChatPromptTemplate.from_template(TABLE_AWARE_SYSTEM_PROMPT)
            self._chain = prompt | self.llm
        return self._chain

    def format_context(self, documents: List[Document]) -> str:
        prioritized = self.context_formatter.prioritize_tables(documents)
        
        context_parts = []
        for i, doc in enumerate(prioritized, 1):
            formatted = self.context_formatter.format_single_document(doc, i)
            context_parts.append(formatted)
        
        return "\n\n" + "\n\n---\n\n".join(context_parts) + "\n\n"

    def generate_answer(
        self,
        question: str,
        retrieved_documents: List[Document]
    ) -> str:
        if not retrieved_documents:
            return "I don't have enough information to answer this question. Please upload relevant documents first."

        context = self.format_context(retrieved_documents)
        logger.info(f"Generating answer for question: {question[:100]}...")
        
        try:
            result = self.chain.invoke({
                "context": context,
                "question": question
            })
            
            answer = result.content if hasattr(result, "content") else str(result)
            logger.info("Answer generated successfully")
            return answer
            
        except Exception as e:
            logger.error(f"Error generating answer: {e}")
            raise RuntimeError(f"Failed to generate answer: {str(e)}")

    def generate_answer_stream(self, question: str, retrieved_documents: List[Document]):
        if not retrieved_documents:
            yield "I don't have enough information to answer this question. Please upload relevant documents first."
            return

        context = self.format_context(retrieved_documents)
        logger.info(f"Streaming answer for question: {question[:100]}...")
        
        try:
            for chunk in self.chain.stream({
                "context": context,
                "question": question
            }):
                yield chunk.content if hasattr(chunk, "content") else str(chunk)
                
        except Exception as e:
            logger.error(f"Error streaming answer: {e}")
            yield f"\n[Error: {str(e)}]"
