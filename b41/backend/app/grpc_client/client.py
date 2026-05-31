import grpc
import os
from typing import Optional
import sys

sys.path.insert(0, os.path.dirname(__file__))

import alignment_pb2
import alignment_pb2_grpc
from ..schemas.schemas import AlignmentResult, ProgressUpdate


class AlignmentGRPCClient:
    def __init__(self, host: str = None, port: int = None):
        self.host = host or os.getenv("GRPC_HOST", "localhost")
        self.port = port or int(os.getenv("GRPC_PORT", "50051"))
        self.channel = None
        self.stub = None

    def _connect(self):
        if self.channel is None:
            self.channel = grpc.insecure_channel(f"{self.host}:{self.port}")
            self.stub = alignment_pb2_grpc.AlignmentServiceStub(self.channel)

    def align(
        self,
        sequence_a: str,
        sequence_b: str,
        match_score: int = 1,
        mismatch_score: int = -1,
        gap_score: int = -2
    ) -> AlignmentResult:
        self._connect()

        request = alignment_pb2.AlignRequest(
            sequence_a=sequence_a,
            sequence_b=sequence_b,
            match_score=match_score,
            mismatch_score=mismatch_score,
            gap_score=gap_score
        )

        response = self.stub.Align(request)

        return AlignmentResult(
            aligned_a=response.aligned_a,
            aligned_b=response.aligned_b,
            alignment_string=response.alignment_string,
            score=response.score,
            progress=[
                ProgressUpdate(
                    step=p.step,
                    total=p.total,
                    message=p.message
                ) for p in response.progress
            ]
        )

    def close(self):
        if self.channel:
            self.channel.close()
            self.channel = None
            self.stub = None


def get_alignment_client() -> AlignmentGRPCClient:
    return AlignmentGRPCClient()
