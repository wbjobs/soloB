import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import streamlit as st

from backend.ingestion import DocumentIngestor
from backend.retriever import Retriever
from backend.config import COLLECTION_NAME, EMBEDDING_MODEL, OLLAMA_MODEL


def init_session_state():
    if "ingestor" not in st.session_state:
        st.session_state.ingestor = None
    if "retriever" not in st.session_state:
        st.session_state.retriever = None
    if "messages" not in st.session_state:
        st.session_state.messages = []
    if "system_ready" not in st.session_state:
        st.session_state.system_ready = False


def init_system():
    if not st.session_state.system_ready:
        try:
            with st.spinner("正在初始化系统..."):
                st.session_state.ingestor = DocumentIngestor(use_milvus=True)
                st.session_state.retriever = Retriever(
                    use_milvus=True,
                    ingestor_instance=st.session_state.ingestor
                )
                st.session_state.system_ready = True
        except Exception as e:
            st.error(f"系统初始化失败: {e}")
            return False
    return True


def display_system_status():
    ingestor = st.session_state.ingestor
    retriever = st.session_state.retriever
    
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        if ingestor:
            if ingestor.use_milvus:
                st.success("向量数据库: Milvus")
            else:
                st.info("向量数据库: FAISS (内存模式)")
        else:
            st.warning("未初始化")
    
    with col2:
        st.info(f"Embedding: {EMBEDDING_MODEL}")
    
    with col3:
        if retriever and retriever.ollama_available:
            st.success(f"LLM: {OLLAMA_MODEL}")
        else:
            st.warning("LLM: 未就绪 (无Ollama)")
    
    with col4:
        if ingestor:
            stats = ingestor.get_collection_stats()
            if stats.get("type") == "faiss":
                st.info(f"文档片段: {stats.get('document_count', 0)}")
            else:
                st.info(f"集合: {COLLECTION_NAME}")


def handle_file_upload():
    uploaded_files = st.file_uploader(
        "上传技术文档",
        type=["pdf", "md"],
        accept_multiple_files=True
    )
    
    if uploaded_files:
        for uploaded_file in uploaded_files:
            if st.button(f"处理: {uploaded_file.name}", key=f"process_{uploaded_file.name}"):
                try:
                    with st.spinner(f"正在处理 {uploaded_file.name}..."):
                        file_bytes = uploaded_file.read()
                        chunk_count = st.session_state.ingestor.ingest_document(
                            file_bytes,
                            uploaded_file.name
                        )
                        st.success(f"成功处理 {uploaded_file.name}，共 {chunk_count} 个文档片段")
                        st.session_state.retriever = Retriever(
                            use_milvus=True,
                            ingestor_instance=st.session_state.ingestor
                        )
                except Exception as e:
                    st.error(f"处理失败: {e}")


def handle_chat():
    if "messages" not in st.session_state:
        st.session_state.messages = []
    
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])
            if "sources" in message and message["sources"]:
                with st.expander("引用来源", expanded=False):
                    for i, source in enumerate(message["sources"]):
                        st.markdown(f"**来源 {i+1}**")
                        st.markdown(f"文件名: {source['filename']}")
                        st.markdown(f"页码: {source['page']}")
                        st.markdown(f"相关度: {source['score']:.2f}")
                        st.markdown(f"内容: {source['text'][:300]}...")
                        st.markdown("---")
    
    if prompt := st.chat_input("请输入您的问题..."):
        st.session_state.messages.append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)
        
        with st.chat_message("assistant"):
            with st.spinner("正在理解上下文并检索相关文档..."):
                try:
                    history_to_pass = [
                        {
                            "role": msg["role"],
                            "content": msg["content"]
                        }
                        for msg in st.session_state.messages[:-1]
                    ]
                    
                    result = st.session_state.retriever.query(
                        question=prompt,
                        chat_history=history_to_pass
                    )
                    
                    answer = result["answer"]
                    sources = result["sources"]
                    llm_used = result["llm_used"]
                    rewritten = result.get("rewritten_question", "")
                    original = result.get("original_question", "")
                    rewrite_method = result.get("rewrite_method", "none")
                    memory_turns = result.get("memory_turns", 0)
                    
                    st.markdown(answer)
                    
                    status_captions = []
                    if llm_used:
                        status_captions.append("AI生成回答")
                    else:
                        status_captions.append("提示: 启动Ollama可获得更智能的回答")
                    
                    if rewritten and rewritten != original and rewrite_method != "none":
                        method_label = "智能重写" if rewrite_method == "llm" else "简单拼接"
                        status_captions.append(f"记忆已使用({memory_turns}条历史), {method_label}")
                    
                    st.caption(" | ".join(status_captions))
                    
                    with st.expander("技术细节", expanded=False):
                        st.markdown(f"**原始问题**: {original}")
                        if rewritten and rewritten != original:
                            st.markdown(f"**重写后问题**: {rewritten}")
                            st.markdown(f"**重写方式**: {rewrite_method}")
                        st.markdown(f"**使用历史**: {memory_turns} 条消息")
                        
                        if "validation_note" in result:
                            st.warning(f"验证: {result['validation_note']}")
                        elif "validated" in result:
                            st.success(f"验证: {'通过' if result['validated'] else '失败'}")
                    
                    if sources:
                        with st.expander("引用来源", expanded=False):
                            for i, source in enumerate(sources):
                                st.markdown(f"**来源 {i+1}**")
                                st.markdown(f"文件名: {source['filename']}")
                                st.markdown(f"页码: {source['page']}")
                                st.markdown(f"相关度: {source['score']:.2f}")
                                st.markdown(f"内容: {source['text']}")
                                st.markdown("---")
                    
                    st.session_state.messages.append({
                        "role": "assistant",
                        "content": answer,
                        "sources": sources
                    })
                except Exception as e:
                    error_msg = f"处理问题时出错: {e}"
                    st.error(error_msg)
                    st.session_state.messages.append({
                        "role": "assistant",
                        "content": error_msg,
                        "sources": []
                    })


def main():
    st.set_page_config(
        page_title="企业技术文档 RAG 系统",
        page_icon="📚",
        layout="wide"
    )
    
    st.title("📚 企业技术文档 RAG 系统")
    st.markdown("基于 LangChain + Milvus + Ollama 的智能文档问答系统")
    
    init_session_state()
    
    if not init_system():
        return
    
    st.divider()
    
    st.subheader("系统状态")
    display_system_status()
    
    st.divider()
    
    col1, col2 = st.columns([1, 2])
    
    with col1:
        st.subheader("文档管理")
        handle_file_upload()
        
        st.divider()
        
        if st.button("清空对话历史"):
            st.session_state.messages = []
            st.rerun()
        
        with st.expander("使用说明"):
            st.markdown("""
            **功能说明：
            - 上传 PDF 或 Markdown 格式的技术文档
            - 系统自动进行文档分块和向量化
            - 在右侧提问，系统检索相关文档并生成回答
            - 每个回答都会标注引用来源
                        
            **环境要求：
            - Milvus 向量数据库 (localhost:19530)
            - Ollama LLM 服务 (localhost:11434)
            - 支持 llama2 或其他模型
            """)
    
    with col2:
        st.subheader("智能问答")
        handle_chat()


if __name__ == "__main__":
    main()
