import grpc
from concurrent import futures
import sys
import os
import pyarrow as pa

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'proto'))

import query_pb2
import query_pb2_grpc

from ..core.query_engine import QueryEngine
from ..core.arrow_handler import ArrowHandler


class QueryService(query_pb2_grpc.QueryServiceServicer):
    def __init__(self, config_path: str = 'config.yaml'):
        self.query_engine = QueryEngine(config_path)
        self.arrow_handler = ArrowHandler()

    def ExecuteQuery(self, request, context):
        try:
            result = self.query_engine.execute(request.sql, use_cache=request.use_cache)
            serialized_data = self.arrow_handler.serialize_table(result)
            
            return query_pb2.QueryResponse(
                success=True,
                data=serialized_data,
                row_count=result.num_rows,
                schema=str(result.schema)
            )
        except Exception as e:
            return query_pb2.QueryResponse(
                success=False,
                error=str(e)
            )

    def ExecuteQueryStream(self, request, context):
        try:
            batch_size = request.batch_size or 10000
            batch_index = 0
            
            for batch in self.query_engine.execute_streaming(request.sql, batch_size=batch_size):
                sink = pa.BufferOutputStream()
                writer = pa.RecordBatchStreamWriter(sink, batch.schema)
                writer.write_batch(batch)
                writer.close()
                
                yield query_pb2.QueryBatch(
                    batch_index=batch_index,
                    row_count=batch.num_rows,
                    data=sink.getvalue().to_pybytes()
                )
                batch_index += 1
                
        except Exception as e:
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))

    def ValidateQuery(self, request, context):
        try:
            is_valid, errors = self.query_engine.validate_query(request.sql)
            return query_pb2.ValidateResponse(
                valid=is_valid,
                errors=errors
            )
        except Exception as e:
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return query_pb2.ValidateResponse(valid=False, errors=[str(e)])

    def GetTables(self, request, context):
        try:
            tables = self.query_engine.get_all_tables()
            response = query_pb2.GetTablesResponse()
            
            for connector_name, table_list in tables.items():
                table_list_proto = query_pb2.TableList()
                table_list_proto.tables.extend(table_list)
                response.tables[connector_name].CopyFrom(table_list_proto)
            
            return response
        except Exception as e:
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return query_pb2.GetTablesResponse()

    def GetSchema(self, request, context):
        try:
            schema = self.query_engine.get_table_schema(request.table_name)
            if schema is None:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Table {request.table_name} not found")
                return query_pb2.GetSchemaResponse()
            
            response = query_pb2.GetSchemaResponse(
                table=request.table_name,
                schema=str(schema)
            )
            
            for field in schema:
                field_proto = query_pb2.Field(
                    name=field.name,
                    type=str(field.type)
                )
                response.fields.append(field_proto)
            
            return response
        except Exception as e:
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return query_pb2.GetSchemaResponse()

    def GetCacheStats(self, request, context):
        try:
            stats = self.query_engine.get_cache_stats()
            if stats is None:
                return query_pb2.GetCacheStatsResponse(cache_enabled=False)
            
            return query_pb2.GetCacheStatsResponse(
                cache_enabled=True,
                total_entries=stats.get('total_entries', 0),
                total_memory_bytes=stats.get('total_memory_bytes', 0),
                total_accesses=stats.get('total_accesses', 0),
                max_size=stats.get('max_size', 0),
                memory_limit_mb=stats.get('memory_limit_mb', 0),
                avg_access_count=stats.get('avg_access_count', 0.0)
            )
        except Exception as e:
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return query_pb2.GetCacheStatsResponse()

    def InvalidateCache(self, request, context):
        try:
            sql = request.sql if request.sql else None
            self.query_engine.invalidate_cache(sql)
            return query_pb2.InvalidateCacheResponse(
                success=True,
                message="Cache invalidated successfully"
            )
        except Exception as e:
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return query_pb2.InvalidateCacheResponse(
                success=False,
                message=str(e)
            )

    def close(self):
        self.query_engine.close()


def serve(port: int = 50051, config_path: str = 'config.yaml'):
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    service = QueryService(config_path)
    query_pb2_grpc.add_QueryServiceServicer_to_server(service, server)
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    print(f"gRPC server started on port {port}")
    
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        service.close()
        server.stop(0)


if __name__ == '__main__':
    serve()
