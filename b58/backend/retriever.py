from typing import List, Dict, Any
import re
import numpy as np

from backend.config import (
    EMBEDDING_MODEL,
    MILVUS_HOST,
    MILVUS_PORT,
    COLLECTION_NAME,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    TOP_K_RESULTS,
    RELEVANCE_THRESHOLD,
    MEMORY_TURNS
)


class Retriever:
    def __init__(self, use_milvus: bool = True, ingestor_instance=None):
        self.use_milvus = use_milvus
        self.ingestor = ingestor_instance
        self.embedding_model = None
        self.milvus_client = None
        
        self._init_embedding()
        if use_milvus:
            self._init_milvus()
        
        self.ollama_available = self._check_ollama()
    
    def _init_embedding(self):
        if self.ingestor and self.ingestor.embedding_model:
            self.embedding_model = self.ingestor.embedding_model
        else:
            from sentence_transformers import SentenceTransformer
            self.embedding_model = SentenceTransformer(EMBEDDING_MODEL)
    
    def _init_milvus(self):
        try:
            from pymilvus import MilvusClient
            self.milvus_client = MilvusClient(uri=f"http://{MILVUS_HOST}:{MILVUS_PORT}")
        except Exception as e:
            print(f"Milvus connection failed: {e}")
            self.use_milvus = False
    
    def _check_ollama(self) -> bool:
        try:
            import requests
            response = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5)
            return response.status_code == 200
        except Exception:
            return False
    
    def _compute_cosine_similarity(self, query_emb: np.ndarray, doc_embs: List[np.ndarray]) -> List[float]:
        similarities = []
        query_norm = np.linalg.norm(query_emb)
        for doc_emb in doc_embs:
            dot = np.dot(query_emb, doc_emb)
            doc_norm = np.linalg.norm(doc_emb)
            sim = dot / (query_norm * doc_norm) if query_norm > 0 and doc_norm > 0 else 0
            similarities.append(sim)
        return similarities
    
    def _filter_by_relevance(self, docs: List[Dict[str, Any]], threshold: float) -> List[Dict[str, Any]]:
        return [doc for doc in docs if doc["score"] >= threshold]
    
    def _format_history(self, history: List[Dict[str, str]], max_turns: int = MEMORY_TURNS) -> List[Dict[str, str]]:
        if not history:
            return []
        
        recent = history[-max_turns * 2:] if max_turns > 0 else history
        
        formatted = []
        for msg in recent:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if content:
                formatted.append({"role": role, "content": content})
        
        return formatted
    
    def _build_rewrite_prompt(self, current_question: str, history: List[Dict[str, str]]) -> str:
        history_text = ""
        for i, msg in enumerate(history):
            role_label = "用户" if msg["role"] == "user" else "助手"
            history_text += f"{role_label}: {msg['content']}\n"
        
        prompt = f"""你是一个对话上下文处理助手。根据以下对话历史，将用户的当前问题重写为一个完整、独立的问题。

【对话历史】
{history_text}

【当前问题】
{current_question}

【任务要求】
1. 如果当前问题包含指代（如"这个"、"那个"、"它"、"刚才的"、"以上"等），请根据历史替换成具体内容
2. 如果当前问题本身已经完整且独立，直接返回原问题
3. 只返回重写后的问题本身，不要添加任何解释、引号或其他内容
4. 如果无法理解上下文，直接返回原问题

【示例】
历史：用户: "系统启动时报错 Error 500"
当前：用户: "这个错误怎么解决？"
重写："系统启动时报错 Error 500 怎么解决？"

历史：用户: "如何配置数据库连接？"
当前：用户: "配置文件在哪里？"
重写："数据库连接的配置文件在哪里？"

历史：用户: "API 接口文档在哪里？"
当前：用户: "谢谢"
重写："谢谢"

【重写结果】"""
        return prompt
    
    def _rewrite_question_with_llm(self, question: str, history: List[Dict[str, str]]) -> str:
        if not history:
            return question
        
        prompt = self._build_rewrite_prompt(question, history)
        
        try:
            import requests
            
            url = f"{OLLAMA_BASE_URL}/api/generate"
            payload = {
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False
            }
            
            response = requests.post(url, json=payload, timeout=60)
            if response.status_code == 200:
                data = response.json()
                rewritten = data.get("response", "").strip()
                
                rewritten = rewritten.strip('"').strip("'").strip()
                
                if rewritten and len(rewritten) > 2:
                    return rewritten
        except Exception:
            pass
        
        return question
    
    def _simple_rewrite(self, question: str, history: List[Dict[str, str]]) -> str:
        if not history:
            return question
        
        user_questions = [msg["content"] for msg in history if msg["role"] == "user"]
        if not user_questions:
            return question
        
        keywords = ["这个", "那个", "它", "刚才", "刚才的", "以上", "这个问题", "那个问题", "刚才那个", "之前的", "那个报错", "那个错误", "这个报错", "这个错误"]
        
        has_anaphora = any(kw in question for kw in keywords)
        
        if has_anaphora:
            last_user_question = user_questions[-1]
            return f"{last_user_question}。{question}"
        
        return question
    
    def rewrite_question(self, question: str, history: List[Dict[str, str]] = None) -> Dict[str, Any]:
        history = self._format_history(history or [])
        
        if not history:
            return {
                "original": question,
                "rewritten": question,
                "method": "none"
            }
        
        if self.ollama_available:
            rewritten = self._rewrite_question_with_llm(question, history)
            method = "llm"
        else:
            rewritten = self._simple_rewrite(question, history)
            method = "simple"
        
        return {
            "original": question,
            "rewritten": rewritten,
            "method": method,
            "history_used": len(history)
        }
    
    def retrieve(self, query: str, top_k: int = TOP_K_RESULTS) -> List[Dict[str, Any]]:
        query_emb = self.embedding_model.encode(query, convert_to_numpy=True)
        
        retrieved_docs = []
        
        if self.use_milvus and self.milvus_client:
            search_params = {"metric_type": "COSINE", "params": {"nprobe": 10}}
            results = self.milvus_client.search(
                collection_name=COLLECTION_NAME,
                data=[query_emb.tolist()],
                limit=top_k,
                search_params=search_params,
                output_fields=["text", "source", "page"]
            )
            
            if results and len(results) > 0:
                for hit in results[0]:
                    retrieved_docs.append({
                        "text": hit.get("entity", {}).get("text", ""),
                        "source": hit.get("entity", {}).get("source", "unknown"),
                        "page": hit.get("entity", {}).get("page", 0),
                        "score": float(hit.get("distance", 0))
                    })
        elif self.ingestor and not self.ingestor.use_milvus:
            if self.ingestor.documents:
                similarities = self._compute_cosine_similarity(query_emb, self.ingestor.embeddings)
                top_indices = np.argsort(similarities)[::-1][:top_k]
                
                for idx in top_indices:
                    if idx < len(self.ingestor.documents):
                        retrieved_docs.append({
                            "text": self.ingestor.documents[idx],
                            "source": self.ingestor.metadata_list[idx]["source"],
                            "page": self.ingestor.metadata_list[idx]["page"],
                            "score": float(similarities[idx])
                        })
        
        return self._filter_by_relevance(retrieved_docs, RELEVANCE_THRESHOLD)
    
    def _build_prompt(
        self, 
        query: str, 
        docs: List[Dict[str, Any]], 
        history: List[Dict[str, str]] = None
    ) -> str:
        history = self._format_history(history or [])
        
        history_text = ""
        if history:
            history_text = "【对话历史】\n"
            for msg in history:
                role_label = "用户" if msg["role"] == "user" else "助手"
                history_text += f"{role_label}: {msg['content']}\n"
            history_text += "\n"
        
        context = ""
        source_list = []
        
        for i, doc in enumerate(docs):
            source = doc["source"]
            page = doc["page"] + 1
            text = doc["text"]
            source_id = i + 1
            context += f"【来源{source_id}】文件: {source}, 页码: {page}\n内容: {text}\n\n"
            source_list.append(f"来源{source_id}: {source}, 页码: {page}")
        
        sources_text = "\n".join(source_list)
        
        prompt = f"""你是一个严格的企业技术文档助手，必须遵守以下规则：

{history_text}【核心规则】
1. 只使用提供的上下文信息回答问题
2. 如果上下文中没有明确包含答案，必须回答："根据知识库，我不知道这个问题的答案。"
3. 绝对不允许编造信息、编造来源或猜测答案
4. 回答中引用的信息必须能在上下文中找到对应原文
5. 如果是多轮对话，请参考对话历史理解用户意图，但回答内容必须来自文档上下文

【可用上下文】
{context}

【所有可用来源】
{sources_text}

【回答要求】
- 如果上下文包含答案：
  * 直接回答问题
  * 在回答中用 [来源X] 格式标注引用（X为来源编号）
  * 可以引用多个来源

- 如果上下文不包含答案或相关性不足：
  * 精确回答："根据知识库，我不知道这个问题的答案。"
  * 不要编造任何内容
  * 不要添加任何其他解释

【错误示例（禁止）】
- "我认为可能是..."
- "根据我的理解..."
- "在文档中提到..."（实际上下文中没有）
- 编造不存在的来源编号或文件名
- 使用对话历史中的内容但不在文档上下文中

用户当前问题: {query}

回答:"""
        return prompt
    
    def _call_ollama(self, prompt: str) -> str:
        try:
            import requests
            
            url = f"{OLLAMA_BASE_URL}/api/generate"
            payload = {
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False
            }
            
            response = requests.post(url, json=payload, timeout=120)
            if response.status_code == 200:
                data = response.json()
                return data.get("response", "").strip()
            else:
                return f"Ollama API调用失败: {response.status_code}"
        except Exception as e:
            return f"调用LLM时出错: {str(e)}"
    
    def _extract_cited_sources(self, answer: str) -> List[int]:
        pattern = r'\[来源(\d+)\]'
        matches = re.findall(pattern, answer)
        return [int(m) for m in matches]
    
    def _validate_answer(self, answer: str, docs: List[Dict[str, Any]], question: str) -> Dict[str, Any]:
        validated = True
        validation_message = ""
        final_answer = answer
        
        cited_sources = self._extract_cited_sources(answer)
        
        for src_num in cited_sources:
            if src_num < 1 or src_num > len(docs):
                validated = False
                validation_message = f"检测到无效的来源引用：来源{src_num}不存在。"
                break
        
        if validated and cited_sources:
            for src_num in cited_sources:
                doc_text = docs[src_num - 1]["text"].lower()
                
                key_phrases = [w for w in re.findall(r'[\w\u4e00-\u9fff]+', question.lower()) if len(w) > 1]
                
                found = False
                for phrase in key_phrases:
                    if phrase in doc_text:
                        found = True
                        break
                
                if not found and len(key_phrases) > 0:
                    found = any(kw in doc_text for kw in ["系统", "功能", "接口", "参数", "配置"])
                
                if not found:
                    validated = False
                    validation_message = f"检测到可能的幻觉：来源{src_num}的内容可能不包含问题相关信息。"
                    break
        
        if not validated:
            final_answer = "根据知识库，我不知道这个问题的答案。"
        
        return {
            "answer": final_answer,
            "validated": validated,
            "message": validation_message
        }
    
    def _build_answer_without_llm(
        self, 
        query: str, 
        docs: List[Dict[str, Any]], 
        original_question: str = None
    ) -> str:
        if not docs:
            return "根据知识库，我不知道这个问题的答案。"
        
        display_question = original_question or query
        
        answer = f"基于检索到的 {len(docs)} 个相关片段（相似度阈值: {RELEVANCE_THRESHOLD}），以下是与您的问题「{display_question}」相关的信息：\n\n"
        
        for i, doc in enumerate(docs):
            source = doc["source"]
            page = doc["page"] + 1
            text = doc["text"]
            score = doc["score"]
            
            answer += f"--- 来源 {i+1} ---\n"
            answer += f"文件: {source}, 页码: {page}, 相似度: {score:.2f}\n"
            answer += f"内容: {text}\n\n"
        
        answer += "\n提示：启动 Ollama 可获得AI生成的回答，且支持更好的多轮对话理解。"
        return answer
    
    def query(
        self, 
        question: str, 
        top_k: int = TOP_K_RESULTS,
        chat_history: List[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        rewrite_info = self.rewrite_question(question, chat_history)
        search_query = rewrite_info["rewritten"]
        
        docs = self.retrieve(search_query, top_k)
        
        result = {
            "original_question": question,
            "rewritten_question": rewrite_info["rewritten"],
            "rewrite_method": rewrite_info["method"],
            "memory_turns": rewrite_info.get("history_used", 0),
            "sources": [
                {
                    "filename": doc["source"],
                    "page": doc["page"] + 1,
                    "text": doc["text"],
                    "score": doc["score"]
                }
                for doc in docs
            ],
            "threshold": RELEVANCE_THRESHOLD
        }
        
        if not docs:
            result["answer"] = "根据知识库，我不知道这个问题的答案。"
            result["llm_used"] = False
            result["filter_note"] = f"未检索到相似度 >= {RELEVANCE_THRESHOLD} 的文档片段"
            return result
        
        history = self._format_history(chat_history or [])
        
        if self.ollama_available:
            prompt = self._build_prompt(search_query, docs, history)
            raw_answer = self._call_ollama(prompt)
            
            validation = self._validate_answer(raw_answer, docs, search_query)
            
            result["answer"] = validation["answer"]
            result["llm_used"] = True
            result["validated"] = validation["validated"]
            if validation["message"]:
                result["validation_note"] = validation["message"]
        else:
            result["answer"] = self._build_answer_without_llm(search_query, docs, question)
            result["llm_used"] = False
        
        return result
