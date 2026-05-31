import re
import json
import chromadb
from chromadb.config import Settings as ChromaSettings
from typing import List, Dict, Any, Optional, AsyncIterator, Tuple
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from config import settings
from document_loader import DocumentProcessor

RAG_PROMPT_TEMPLATE = """你是一个企业内部知识问答机器人。请严格遵循以下规则回答问题：

规则说明：
1. 只使用下方提供的"相关文档"中的信息回答问题
2. 如果多个文档存在，请优先使用相关性分数更高的文档（分数越低表示越相关）
3. 文档标题以 [文档N] 开头，数字越小表示相关性越高
4. 如果相关文档中没有答案，或者文档内容与问题无关，请明确说："抱歉，我在知识库中没有找到与您的问题相关的信息。"
5. 不要编造信息，不要使用你的通用知识来回答
6. 回答要简洁、准确、专业

【重要】引用来源规则：
- 在回答的每一句话后面，用方括号标注该信息来源的文档编号，如：[1]、[2]
- 如果一句话的信息来自多个文档，可以标注多个引用，如：[1][3]
- 如果一句话是你自己的组织语言，不需要标注来源
- 引用要紧跟在相关信息的句子后面，不要放在段落末尾
- 示例：
  正确：报销申请需要填写费用明细单[1]，并附上原始发票[2]。
  错误：报销申请需要填写费用明细单，并附上原始发票。[1][2]

相关文档（按相关性从高到低排序）：
{context}

用户问题：{question}

请只基于上述文档回答问题，并在相关内容后标注引用来源。如果文档内容与问题不相关，请明确说明无法回答。

回答："""

RERANK_PROMPT_TEMPLATE = """你是一个文档相关性评估专家。请评估以下文档与用户问题的相关性。

评估标准：
- 5分：文档完全回答了用户问题，内容高度相关
- 4分：文档包含用户问题的关键信息，需要进一步组织语言
- 3分：文档有部分相关信息，但不够完整
- 2分：文档提及了相关主题，但没有具体答案
- 1分：文档完全不相关，或内容与问题无关

用户问题：{question}

文档内容：
{document_content}

请输出一个JSON对象，格式如下：
{{"relevance_score": 评分(1-5的整数), "reason": "简要说明理由"}}"""

class RAGPipeline:
    def __init__(self):
        self.chroma_client = chromadb.PersistentClient(
            path=settings.CHROMA_DB_PATH,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        self.collection = self.chroma_client.get_or_create_collection(
            name=settings.CHROMA_COLLECTION_NAME,
        )
        self.embeddings = OpenAIEmbeddings(
            model=settings.EMBEDDING_MODEL,
            openai_api_key=settings.OPENAI_API_KEY,
        )
        self.llm = ChatOpenAI(
            model=settings.OPENAI_MODEL,
            openai_api_key=settings.OPENAI_API_KEY,
            temperature=0.3,
        )
        self.reranker_llm = ChatOpenAI(
            model=settings.RERANKER_MODEL,
            openai_api_key=settings.OPENAI_API_KEY,
            temperature=0.0,
        )
        self.document_processor = DocumentProcessor()
        self.max_retrieved_docs = settings.MAX_RETRIEVED_DOCS
        self.min_relevance_score = settings.MIN_RELEVANCE_SCORE
        self.enable_reranking = settings.ENABLE_RERANKING
        self.rerank_top_k = settings.RERANK_TOP_K

    def _distance_to_similarity(self, distance: float) -> float:
        return max(0.0, 1.0 - distance)

    def _filter_by_relevance(
        self, docs: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        filtered = []
        for doc in docs:
            similarity = self._distance_to_similarity(doc["distance"])
            if similarity >= self.min_relevance_score:
                doc["similarity"] = similarity
                filtered.append(doc)
        return filtered

    def _calculate_keyword_relevance(self, query: str, doc_content: str) -> float:
        query_keywords = set(re.findall(r'[\w\u4e00-\u9fff]+', query.lower()))
        doc_words = set(re.findall(r'[\w\u4e00-\u9fff]+', doc_content.lower()))
        
        if not query_keywords:
            return 0.5
        
        matched_keywords = query_keywords & doc_words
        keyword_score = len(matched_keywords) / len(query_keywords)
        
        exact_match_score = 0.0
        for keyword in query_keywords:
            if keyword in doc_content.lower():
                exact_match_score += 1.0
        
        exact_match_score = exact_match_score / len(query_keywords) if query_keywords else 0.0
        
        return 0.4 * keyword_score + 0.6 * exact_match_score

    def _rerank_with_llm(
        self, query: str, docs: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        if not self.enable_reranking or len(docs) <= 1:
            return docs

        reranked_docs = []
        rerank_prompt = ChatPromptTemplate.from_template(RERANK_PROMPT_TEMPLATE)
        chain = rerank_prompt | self.reranker_llm | StrOutputParser()

        for doc in docs:
            try:
                response = chain.invoke({
                    "question": query,
                    "document_content": doc["content"][:2000],
                })
                
                json_match = re.search(r'\{.*\}', response, re.DOTALL)
                if json_match:
                    result = json.loads(json_match.group())
                    rerank_score = result.get("relevance_score", 3)
                    doc["rerank_score"] = rerank_score
                    doc["rerank_reason"] = result.get("reason", "")
                else:
                    doc["rerank_score"] = 3
                    doc["rerank_reason"] = "解析失败，使用默认分数"
            except Exception as e:
                doc["rerank_score"] = 3
                doc["rerank_reason"] = f"重排序失败: {str(e)}"
            
            reranked_docs.append(doc)

        reranked_docs.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)
        
        high_relevance_docs = [d for d in reranked_docs if d.get("rerank_score", 0) >= 3]
        
        return high_relevance_docs[:self.rerank_top_k] if high_relevance_docs else reranked_docs[:1]

    def _format_docs_with_labels(
        self, docs: List[Dict[str, Any]]
    ) -> str:
        formatted_parts = []
        for i, doc in enumerate(docs, 1):
            similarity = doc.get("similarity", 0.0)
            distance = doc.get("distance", 0.0)
            rerank_score = doc.get("rerank_score", "N/A")
            source = doc.get("metadata", {}).get("source", "未知来源")
            
            header = f"[文档{i}] 相关性分数: {distance:.3f} (相似度: {similarity:.2f})"
            if rerank_score != "N/A":
                header += f" | LLM重排分数: {rerank_score}"
            header += f" | 来源: {source}"
            
            formatted_parts.append(f"{header}\n{doc['content']}")
        
        return "\n\n---\n\n".join(formatted_parts)

    def _extract_citation_refs(self, text: str) -> List[str]:
        pattern = r'\[(\d+)\]'
        matches = re.findall(pattern, text)
        unique_refs = sorted(set(matches), key=lambda x: int(x))
        return [f"[{ref}]" for ref in unique_refs]

    def _remove_citation_markers(self, text: str) -> str:
        pattern = r'\[\d+\]'
        return re.sub(pattern, '', text).strip()

    def _build_citation_sources(
        self,
        retrieved_docs: List[Dict[str, Any]],
        answer_with_citations: str,
    ) -> List[Dict[str, Any]]:
        citations = []
        used_refs = self._extract_citation_refs(answer_with_citations)
        
        for ref_str in used_refs:
            ref_num = int(ref_str.strip('[]'))
            doc_index = ref_num - 1
            
            if 0 <= doc_index < len(retrieved_docs):
                doc = retrieved_docs[doc_index]
                source_path = doc.get("metadata", {}).get("source", "未知来源")
                source_file = source_path.split('/')[-1].split('\\')[-1]
                
                citation = {
                    "ref_id": ref_str,
                    "document_index": doc_index,
                    "source_file": source_file,
                    "source_path": source_path,
                    "page_number": doc.get("metadata", {}).get("page"),
                    "content_preview": doc.get("content", "")[:200] + ("..." if len(doc.get("content", "")) > 200 else ""),
                    "full_content": doc.get("content", ""),
                    "distance": doc.get("distance", 0.0),
                    "similarity": doc.get("similarity", 0.0),
                    "rerank_score": doc.get("rerank_score"),
                }
                citations.append(citation)
        
        return citations

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self.embeddings.embed_documents(texts)

    def embed_query(self, query: str) -> List[float]:
        return self.embeddings.embed_query(query)

    def add_documents(self, documents: List[Document]) -> int:
        chroma_data = self.document_processor.convert_to_chroma_format(documents)
        embeddings = self.embed_documents(chroma_data["documents"])
        
        self.collection.add(
            ids=chroma_data["ids"],
            documents=chroma_data["documents"],
            metadatas=chroma_data["metadatas"],
            embeddings=embeddings,
        )
        
        return len(chroma_data["ids"])

    def add_from_file(self, file_path: str) -> int:
        documents = self.document_processor.process_file(file_path)
        return self.add_documents(documents)

    def add_from_directory(self, directory_path: str) -> int:
        documents = self.document_processor.process_directory(directory_path)
        return self.add_documents(documents)

    def retrieve(self, query: str, n_results: int = None) -> List[Dict[str, Any]]:
        query_embedding = self.embed_query(query)
        n_results = n_results or self.max_retrieved_docs
        
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results * 2,
            include=["documents", "metadatas", "distances"],
        )
        
        retrieved_docs = []
        if results["documents"] and len(results["documents"][0]) > 0:
            for i in range(len(results["documents"][0])):
                retrieved_docs.append({
                    "content": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                    "distance": results["distances"][0][i] if results["distances"] else 0.0,
                })
        
        return retrieved_docs

    def retrieve_enhanced(
        self, query: str, n_results: int = None
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        raw_docs = self.retrieve(query, n_results)
        
        debug_info = {
            "query": query,
            "initial_retrieved_count": len(raw_docs),
            "initial_docs": [
                {
                    "distance": d["distance"],
                    "source": d["metadata"].get("source", "N/A"),
                    "preview": d["content"][:100] + "..."
                }
                for d in raw_docs
            ],
        }
        
        filtered_docs = self._filter_by_relevance(raw_docs)
        debug_info["after_filter_count"] = len(filtered_docs)
        
        for doc in filtered_docs:
            doc["keyword_score"] = self._calculate_keyword_relevance(
                query, doc["content"]
            )
        
        filtered_docs.sort(key=lambda x: (x["distance"], -x.get("keyword_score", 0)))
        filtered_docs = filtered_docs[:self.max_retrieved_docs]
        
        debug_info["after_keyword_sort_count"] = len(filtered_docs)
        
        if self.enable_reranking and len(filtered_docs) > 1:
            reranked_docs = self._rerank_with_llm(query, filtered_docs)
            debug_info["after_rerank_count"] = len(reranked_docs)
            debug_info["reranked_docs"] = [
                {
                    "rerank_score": d.get("rerank_score"),
                    "rerank_reason": d.get("rerank_reason"),
                    "distance": d["distance"],
                    "preview": d["content"][:100] + "..."
                }
                for d in reranked_docs
            ]
            final_docs = reranked_docs
        else:
            final_docs = filtered_docs
            debug_info["reranking_disabled"] = True
        
        debug_info["final_count"] = len(final_docs)
        
        return final_docs, debug_info

    def retrieve_as_documents(self, query: str, n_results: int = None) -> List[Document]:
        retrieved, _ = self.retrieve_enhanced(query, n_results)
        return [
            Document(page_content=doc["content"], metadata=doc["metadata"])
            for doc in retrieved
        ]

    def build_context(self, query: str, n_results: int = None) -> Tuple[str, Dict[str, Any]]:
        retrieved_docs, debug_info = self.retrieve_enhanced(query, n_results)
        
        if not retrieved_docs:
            return "【无相关文档】", debug_info
        
        context = self._format_docs_with_labels(retrieved_docs)
        return context, debug_info

    def generate_answer(self, query: str, context: str) -> str:
        prompt = ChatPromptTemplate.from_template(RAG_PROMPT_TEMPLATE)
        chain = prompt | self.llm | StrOutputParser()
        
        return chain.invoke({
            "context": context,
            "question": query,
        })

    def answer(self, query: str) -> Dict[str, Any]:
        retrieved_docs, debug_info = self.retrieve_enhanced(query)
        
        if not retrieved_docs:
            return {
                "question": query,
                "answer": "抱歉，我在知识库中没有找到与您的问题相关的信息。",
                "answer_with_citations": "抱歉，我在知识库中没有找到与您的问题相关的信息。",
                "context": "【无相关文档】",
                "citations": [],
                "debug_info": debug_info,
            }
        
        context = self._format_docs_with_labels(retrieved_docs)
        answer_with_citations = self.generate_answer(query, context)
        answer = self._remove_citation_markers(answer_with_citations)
        citations = self._build_citation_sources(retrieved_docs, answer_with_citations)
        
        return {
            "question": query,
            "answer": answer,
            "answer_with_citations": answer_with_citations,
            "context": context,
            "citations": citations,
            "debug_info": debug_info,
        }

    async def answer_stream(self, query: str) -> AsyncIterator[str]:
        context, debug_info = self.build_context(query)
        
        prompt = ChatPromptTemplate.from_template(RAG_PROMPT_TEMPLATE)
        chain = prompt | self.llm | StrOutputParser()
        
        async for chunk in chain.astream({
            "context": context,
            "question": query,
        }):
            yield chunk

    def get_collection_stats(self) -> Dict[str, Any]:
        count = self.collection.count()
        return {
            "collection_name": settings.CHROMA_COLLECTION_NAME,
            "document_count": count,
            "embedding_model": settings.EMBEDDING_MODEL,
            "llm_model": settings.OPENAI_MODEL,
            "enable_reranking": self.enable_reranking,
            "min_relevance_score": self.min_relevance_score,
            "rerank_top_k": self.rerank_top_k,
        }

    def clear_collection(self) -> None:
        self.chroma_client.delete_collection(settings.CHROMA_COLLECTION_NAME)
        self.collection = self.chroma_client.get_or_create_collection(
            name=settings.CHROMA_COLLECTION_NAME,
        )
