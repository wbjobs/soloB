package com.syscall.monitor;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.api.common.functions.RuntimeContext;
import org.apache.flink.api.java.tuple.Tuple2;
import org.apache.flink.connector.base.DeliveryGuarantee;
import org.apache.flink.connector.elasticsearch.sink.Elasticsearch7SinkBuilder;
import org.apache.flink.connector.elasticsearch.sink.RequestIndexer;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.datastream.SingleOutputStreamOperator;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.windowing.assigners.TumblingProcessingTimeWindows;
import org.apache.flink.streaming.api.windowing.time.Time;
import org.apache.flink.util.Collector;
import org.elasticsearch.action.index.IndexRequest;
import org.elasticsearch.client.Requests;

import java.time.Duration;

public class SimpleSyscallAggregationJob {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        final StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();

        String kafkaBrokers = System.getenv().getOrDefault("KAFKA_BROKERS", "localhost:9092");
        String kafkaTopic = System.getenv().getOrDefault("KAFKA_TOPIC", "syscalls");
        String kafkaGroupId = System.getenv().getOrDefault("KAFKA_GROUP_ID", "syscall-flink-consumer");
        String elasticsearchHosts = System.getenv().getOrDefault("ES_HOSTS", "http://localhost:9200");
        String elasticsearchIndex = System.getenv().getOrDefault("ES_INDEX", "syscall-aggregations");
        long windowSizeMs = Long.parseLong(System.getenv().getOrDefault("WINDOW_SIZE_MS", "1000"));

        KafkaSource<String> kafkaSource = KafkaSource.<String>builder()
                .setBootstrapServers(kafkaBrokers)
                .setTopics(kafkaTopic)
                .setGroupId(kafkaGroupId)
                .setStartingOffsets(OffsetsInitializer.latest())
                .setValueOnlyDeserializer(new org.apache.flink.api.common.serialization.SimpleStringSchema())
                .build();

        DataStream<String> kafkaStream = env.fromSource(
                kafkaSource,
                org.apache.flink.api.common.eventtime.WatermarkStrategy.forBoundedOutOfOrderness(Duration.ofSeconds(5)),
                "Kafka Source"
        );

        SingleOutputStreamOperator<SyscallEvent> eventStream = kafkaStream
                .map((MapFunction<String, SyscallEvent>) json -> {
                    try {
                        return objectMapper.readValue(json, SyscallEvent.class);
                    } catch (Exception e) {
                        System.err.println("Failed to parse event: " + json);
                        return null;
                    }
                })
                .filter(event -> event != null && event.isEnter())
                .name("Parse and Filter");

        SingleOutputStreamOperator<SyscallAggregation> aggregationStream = eventStream
                .map(event -> new Tuple2<>(Tuple3.of(event.getTgid(), event.getSyscall(), event.getTimestamp()), 1L))
                .returns(new org.apache.flink.api.common.typeinfo.TypeHint<Tuple2<Tuple3<Long, String, Long>, Long>>() {})
                .keyBy(tuple -> Tuple2.of(tuple.f0.f0, tuple.f0.f1))
                .window(TumblingProcessingTimeWindows.of(Time.milliseconds(windowSizeMs)))
                .apply((key, window, values, out) -> {
                    long count = 0;
                    Long tgid = key.f0;
                    String syscall = key.f1;
                    
                    for (Tuple2<Tuple3<Long, String, Long>, Long> value : values) {
                        count += value.f1;
                    }
                    
                    SyscallAggregation agg = new SyscallAggregation();
                    agg.setTgid(tgid);
                    agg.setSyscall(syscall);
                    agg.setCount(count);
                    agg.setWindowStart(window.getStart());
                    agg.setWindowEnd(window.getEnd());
                    agg.setTimestamp(System.currentTimeMillis());
                    
                    out.collect(agg);
                })
                .name("Aggregate");

        aggregationStream.sinkTo(
                new Elasticsearch7SinkBuilder<SyscallAggregation>()
                        .setHosts(elasticsearchHosts.split(","))
                        .setDeliveryGuarantee(DeliveryGuarantee.AT_LEAST_ONCE)
                        .setEmitter((aggregation, context, indexer) -> {
                            try {
                                String json = objectMapper.writeValueAsString(aggregation);
                                IndexRequest request = Requests.indexRequest()
                                        .index(elasticsearchIndex)
                                        .id(aggregation.getId())
                                        .source(json, org.elasticsearch.common.xcontent.XContentType.JSON);
                                indexer.add(request);
                            } catch (Exception e) {
                                throw new RuntimeException("Failed to create index request", e);
                            }
                        })
                        .build()
        ).name("Elasticsearch Sink");

        aggregationStream.print();

        env.execute("Simple Syscall Aggregation Job");
    }

    public static class Tuple3<T0, T1, T2> {
        public T0 f0;
        public T1 f1;
        public T2 f2;

        public Tuple3() {}

        public Tuple3(T0 f0, T1 f1, T2 f2) {
            this.f0 = f0;
            this.f1 = f1;
            this.f2 = f2;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Tuple3<?, ?, ?> tuple3 = (Tuple3<?, ?, ?>) o;
            return java.util.Objects.equals(f0, tuple3.f0) &&
                   java.util.Objects.equals(f1, tuple3.f1) &&
                   java.util.Objects.equals(f2, tuple3.f2);
        }

        @Override
        public int hashCode() {
            return java.util.Objects.hash(f0, f1, f2);
        }
    }
}
