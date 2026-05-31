import pyarrow as pa
from typing import Iterator, List, Dict, Any, Optional, Callable
import asyncio
from dataclasses import dataclass


@dataclass
class StreamBatch:
    batch_index: int
    total_batches: int
    data: pa.RecordBatch
    row_count: int


class StreamProcessor:
    def __init__(self, batch_size: int = 10000):
        self.batch_size = batch_size

    def stream_table(self, 
                     table: pa.Table,
                     batch_size: Optional[int] = None
                     ) -> Iterator[StreamBatch]:
        actual_batch_size = batch_size or self.batch_size
        total_rows = table.num_rows
        total_batches = (total_rows + actual_batch_size - 1) // actual_batch_size
        
        for i in range(0, total_rows, actual_batch_size):
            end = min(i + actual_batch_size, total_rows)
            batch = table.slice(i, end - i).to_batches()[0]
            
            yield StreamBatch(
                batch_index=i // actual_batch_size,
                total_batches=total_batches,
                data=batch,
                row_count=batch.num_rows
            )

    async def async_stream_table(self,
                                 table: pa.Table,
                                 batch_size: Optional[int] = None,
                                 delay_between_batches: float = 0.0
                                 ) -> Iterator[StreamBatch]:
        actual_batch_size = batch_size or self.batch_size
        total_rows = table.num_rows
        total_batches = (total_rows + actual_batch_size - 1) // actual_batch_size
        
        for i in range(0, total_rows, actual_batch_size):
            end = min(i + actual_batch_size, total_rows)
            batch = table.slice(i, end - i).to_batches()[0]
            
            yield StreamBatch(
                batch_index=i // actual_batch_size,
                total_batches=total_batches,
                data=batch,
                row_count=batch.num_rows
            )
            
            if delay_between_batches > 0:
                await asyncio.sleep(delay_between_batches)

    def stream_to_json(self,
                       table: pa.Table,
                       batch_size: Optional[int] = None
                       ) -> Iterator[Dict[str, Any]]:
        for batch in self.stream_table(table, batch_size):
            yield {
                'batch_index': batch.batch_index,
                'total_batches': batch.total_batches,
                'row_count': batch.row_count,
                'data': batch.data.to_pylist()
            }

    def stream_to_csv(self,
                      table: pa.Table,
                      batch_size: Optional[int] = None,
                      include_header: bool = True
                      ) -> Iterator[str]:
        first = True
        schema = table.schema
        
        for batch in self.stream_table(table, batch_size):
            df = batch.data.to_pandas()
            
            if first and include_header:
                yield df.to_csv(index=False)
                first = False
            else:
                yield df.to_csv(index=False, header=False)

    def batch_to_bytes(self, batch: StreamBatch) -> bytes:
        sink = pa.BufferOutputStream()
        writer = pa.RecordBatchStreamWriter(sink, batch.data.schema)
        writer.write_batch(batch.data)
        writer.close()
        return sink.getvalue().to_pybytes()

    def bytes_to_batch(self, data: bytes, schema: pa.Schema) -> StreamBatch:
        reader = pa.RecordBatchStreamReader(pa.py_buffer(data))
        batch = reader.read_next_batch()
        
        return StreamBatch(
            batch_index=0,
            total_batches=1,
            data=batch,
            row_count=batch.num_rows
        )

    def transform_stream(self,
                         stream: Iterator[StreamBatch],
                         transform_fn: Callable[[pa.RecordBatch], pa.RecordBatch]
                         ) -> Iterator[StreamBatch]:
        for batch in stream:
            transformed_data = transform_fn(batch.data)
            
            yield StreamBatch(
                batch_index=batch.batch_index,
                total_batches=batch.total_batches,
                data=transformed_data,
                row_count=transformed_data.num_rows
            )

    def filter_stream(self,
                      stream: Iterator[StreamBatch],
                      filter_fn: Callable[[pa.RecordBatch], pa.RecordBatch]
                      ) -> Iterator[StreamBatch]:
        for batch in stream:
            filtered_data = filter_fn(batch.data)
            
            if filtered_data.num_rows > 0:
                yield StreamBatch(
                    batch_index=batch.batch_index,
                    total_batches=batch.total_batches,
                    data=filtered_data,
                    row_count=filtered_data.num_rows
                )

    def aggregate_stream(self,
                         stream: Iterator[StreamBatch],
                         aggregate_fn: Callable[[List[pa.RecordBatch]], pa.Table]
                         ) -> pa.Table:
        batches = [batch.data for batch in stream]
        return aggregate_fn(batches)

    def collect_stream(self, stream: Iterator[StreamBatch]) -> pa.Table:
        batches = [batch.data for batch in stream]
        if not batches:
            return pa.Table.from_pylist([])
        return pa.Table.from_batches(batches, batches[0].schema)

    def stream_with_progress(self,
                             table: pa.Table,
                             batch_size: Optional[int] = None,
                             progress_callback: Optional[Callable[[int, int], None]] = None
                             ) -> Iterator[StreamBatch]:
        for batch in self.stream_table(table, batch_size):
            if progress_callback:
                progress_callback(batch.batch_index + 1, batch.total_batches)
            yield batch

    def limit_stream(self,
                     stream: Iterator[StreamBatch],
                     max_rows: int
                     ) -> Iterator[StreamBatch]:
        rows_returned = 0
        
        for batch in stream:
            if rows_returned >= max_rows:
                break
            
            remaining = max_rows - rows_returned
            
            if batch.row_count > remaining:
                limited_data = batch.data.slice(0, remaining)
                yield StreamBatch(
                    batch_index=batch.batch_index,
                    total_batches=batch.total_batches,
                    data=limited_data,
                    row_count=remaining
                )
                rows_returned = max_rows
            else:
                yield batch
                rows_returned += batch.row_count

    def split_stream_by_column(self,
                               table: pa.Table,
                               column_name: str,
                               batch_size: Optional[int] = None
                               ) -> Dict[Any, List[pa.RecordBatch]]:
        partitions: Dict[Any, List[pa.RecordBatch]] = {}
        
        for batch in self.stream_table(table, batch_size):
            col_index = batch.data.schema.get_field_index(column_name)
            if col_index < 0:
                continue
            
            col_data = batch.data.column(col_index)
            
            for i in range(batch.data.num_rows):
                value = col_data[i].as_py()
                single_row = batch.data.slice(i, 1)
                
                if value not in partitions:
                    partitions[value] = []
                partitions[value].append(single_row)
        
        return partitions

    def merge_streams(self,
                      streams: List[Iterator[StreamBatch]]
                      ) -> Iterator[StreamBatch]:
        batch_index = 0
        total_batches = 0
        
        all_batches = []
        for stream in streams:
            batches = list(stream)
            all_batches.extend(batches)
            total_batches += len(batches)
        
        for batch in all_batches:
            yield StreamBatch(
                batch_index=batch_index,
                total_batches=total_batches,
                data=batch.data,
                row_count=batch.row_count
            )
            batch_index += 1

    def get_stream_statistics(self, stream: Iterator[StreamBatch]) -> Dict[str, Any]:
        total_rows = 0
        total_batches = 0
        total_size = 0
        schemas = set()
        
        for batch in stream:
            total_rows += batch.row_count
            total_batches += 1
            total_size += self.batch_to_bytes(batch).__len__()
            schemas.add(str(batch.data.schema))
        
        return {
            'total_rows': total_rows,
            'total_batches': total_batches,
            'total_bytes': total_size,
            'avg_batch_size': total_rows / total_batches if total_batches > 0 else 0,
            'unique_schemas': len(schemas),
            'schemas': list(schemas)
        }
