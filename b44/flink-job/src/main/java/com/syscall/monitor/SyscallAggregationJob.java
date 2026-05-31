package com.syscall.monitor;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.api.common.functions.RuntimeContext;
import org.apache.flink.api.java.functions.KeySelector;
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
import org.elasticsearch.action.index.IndexRequest;
import org.elasticsearch.client.Requests;

import java.time.Duration;
import java.util.Properties;

public class SyscallAggregationJob {

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
                .setProperty("partition.discovery.interval.ms", "10000")
                .build();

        DataStream<String> kafkaStream = env.fromSource(
                kafkaSource,
                WatermarkStrategy.forBoundedOutOfOrderness(Duration.ofSeconds(5)),
                "Kafka Source"
        );

        SingleOutputStreamOperator<SyscallEvent> eventStream = kafkaStream
                .map((MapFunction<String, SyscallEvent>) SyscallAggregationJob::parseEvent)
                .name("Parse JSON Events")
                .filter(event -> event != null && event.isEnter())
                .name("Filter Enter Events");

        SingleOutputStreamOperator<SyscallAggregation> aggregationStream = eventStream
                .assignTimestampsAndWatermarks(
                        WatermarkStrategy.<SyscallEvent>forMonotonousTimestamps()
                                .withTimestampAssigner((event, timestamp) -> event.getTimestamp())
                )
                .keyBy(new KeySelector<SyscallEvent, Tuple2<Long, String>>() {
                    @Override
                    public Tuple2<Long, String> getKey(SyscallEvent event) {
                        return new Tuple2<>(event.getTgid(), event.getSyscall());
                    }
                })
                .window(TumblingProcessingTimeWindows.of(Time.milliseconds(windowSizeMs)))
                .aggregate(new SyscallAggregateFunction())
                .name("Window Aggregation");

        aggregationStream
                .sinkTo(new Elasticsearch7SinkBuilder<SyscallAggregation>()
                        .setHosts(elasticsearchHosts.split(","))
                        .setDeliveryGuarantee(DeliveryGuarantee.AT_LEAST_ONCE)
                        .setBulkFlushMaxActions(1)
                        .setEmitter((SyscallAggregation aggregation, RuntimeContext context, RequestIndexer indexer) -> {
                            indexer.add(createIndexRequest(aggregation, elasticsearchIndex));
                        })
                        .build())
                .name("Elasticsearch Sink");

        aggregationStream.print();

        env.execute("Syscall Monitoring and Aggregation Job");
    }

    private static SyscallEvent parseEvent(String json) {
        try {
            return objectMapper.readValue(json, SyscallEvent.class);
        } catch (Exception e) {
            System.err.println("Failed to parse event: " + json);
            e.printStackTrace();
            return null;
        }
    }

    private static IndexRequest createIndexRequest(SyscallAggregation aggregation, String index) {
        try {
            String json = objectMapper.writeValueAsString(aggregation);
            return Requests.indexRequest()
                    .index(index)
                    .id(aggregation.getId())
                    .source(json, org.elasticsearch.common.xcontent.XContentType.JSON);
        } catch (Exception e) {
            throw new RuntimeException("Failed to create index request", e);
        }
    }

    public static class Tuple2<T0, T1> {
        public T0 f0;
        public T1 f1;

        public Tuple2(T0 f0, T1 f1) {
            this.f0 = f0;
            this.f1 = f1;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Tuple2<?, ?> tuple2 = (Tuple2<?, ?>) o;
            return java.util.Objects.equals(f0, tuple2.f0) &&
                   java.util.Objects.equals(f1, tuple2.f1);
        }

        @Override
        public int hashCode() {
            return java.util.Objects.hash(f0, f1);
        }
    }
}
