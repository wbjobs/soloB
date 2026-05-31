from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class CitationSource(BaseModel):
    ref_id: str = Field(..., description="引用编号，如 [1], [2]")
    document_index: int = Field(..., description="文档索引")
    source_file: str = Field(..., description="源文件路径/名称")
    page_number: Optional[int] = Field(default=None, description="页码（仅PDF有）")
    content_preview: str = Field(..., description="相关内容预览")
    distance: float = Field(..., description="向量距离")
    similarity: float = Field(..., description="相似度分数")
    rerank_score: Optional[int] = Field(default=None, description="LLM重排分数")

class QueryRequest(BaseModel):
    question: str = Field(..., description="用户的问题")
    stream: bool = Field(default=True, description="是否使用流式输出")
    n_results: Optional[int] = Field(default=None, description="检索的文档数量")
    include_citations: bool = Field(default=True, description="是否返回引用来源")

class QueryResponse(BaseModel):
    question: str
    answer: str
    answer_with_citations: str = Field(..., description="带有引用标记的回答")
    context: str
    citations: List[CitationSource] = Field(default_factory=list, description="引用来源列表")
    debug_info: Optional[Dict[str, Any]] = Field(default=None, description="调试信息")

class DocumentUploadResponse(BaseModel):
    success: bool
    message: str
    document_count: Optional[int] = None

class CollectionStatsResponse(BaseModel):
    collection_name: str
    document_count: int
    embedding_model: str
    llm_model: str

class RetrieveResponse(BaseModel):
    content: str
    metadata: Dict[str, Any]
    distance: float
