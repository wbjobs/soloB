package com.syscall.monitor;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.connector.base.DeliveryGuarantee;
import org.apache.flink.connector.elasticsearch.sink.Elasticsearch7SinkBuilder;
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
import java.util.HashMap;
import java.util.Map;

public class ReliableSyscallJob {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        final StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        
        env.enableCheckpointing(60000);
        
        String kafkaBrokers = System.getenv().getOrDefault("KAFKA_BROKERS", "localhost:9092");
        String kafkaTopic = System.getenv().getOrDefault("KAFKA_TOPIC", "syscalls");
        String kafkaGroupId = System.getenv().getOrDefault("KAFKA_GROUP_ID", "syscall-flink-consumer");
        String elasticsearchHosts = System.getenv().getOrDefault("ES_HOSTS", "http://localhost:9200");
        String elasticsearchIndex = System.getenv().getOrDefault("ES_INDEX", "syscall-aggregations");
        long windowSizeMs = Long.parseLong(System.getenv().getOrDefault("WINDOW_SIZE_MS", "1000"));

        System.out.println("===============================================");
        System.out.println("  Reliable Syscall Flink Job Starting");
        System.out.println("===============================================");
        System.out.println("Kafka Brokers: " + kafkaBrokers);
        System.out.println("Kafka Topic: " + kafkaTopic);
        System.out.println("Elasticsearch: " + elasticsearchHosts);
        System.out.println("Window Size: " + windowSizeMs + "ms");
        System.out.println("===============================================");

        KafkaSource<String> kafkaSource = KafkaSource.<String>builder()
                .setBootstrapServers(kafkaBrokers)
                .setTopics(kafkaTopic)
                .setGroupId(kafkaGroupId)
                .setStartingOffsets(OffsetsInitializer.latest())
                .setValueOnlyDeserializer(new SimpleStringSchema())
                .setProperty("partition.discovery.interval.ms", "10000")
                .build();

        DataStream<String> kafkaStream = env.fromSource(
                kafkaSource,
                WatermarkStrategy.forBoundedOutOfOrderness(Duration.ofSeconds(5)),
                "Kafka Source"
        );

        SingleOutputStreamOperator<Map<String, Object>> parsedStream = kafkaStream
                .map(new MapFunction<String, Map<String, Object>>() {
                    @Override
                    public Map<String, Object> map(String json) {
                        try {
                            JsonNode node = objectMapper.readTree(json);
                            
                            boolean isEnter = node.has("is_enter") ? node.get("is_enter").asBoolean() : 
                                             (node.has("is_exit") ? !node.get("is_exit").asBoolean() : true);
                            
                            if (!isEnter) {
                                return null;
                            }
                            
                            Map<String, Object> result = new HashMap<>();
                            result.put("tgid", node.has("tgid") ? node.get("tgid").asLong() : 
                                              node.has("pid") ? node.get("pid").asLong() : 0L);
                            result.put("syscall", node.has("syscall") ? node.get("syscall").asText() : "unknown");
                            result.put("timestamp", System.currentTimeMillis());
                            
                            return result;
                        } catch (Exception e) {
                            System.err.println("Failed to parse JSON: " + json);
                            return null;
                        }
                    }
                })
                .filter(event -> event != null)
                .name("Parse and Filter Events");

        parsedStream
                .keyBy(event -> event.get("tgid") + "_" + event.get("syscall"))
                .window(TumblingProcessingTimeWindows.of(Time.milliseconds(windowSizeMs)))
                .apply((key, window, values, out) -> {
                    long count = 0;
                    Long tgid = 0L;
                    String syscall = "";
                    
                    for (Map<String, Object> value : values) {
                        count++;
                        tgid = (Long) value.get("tgid");
                        syscall = (String) value.get("syscall");
                    }
                    
                    if (count > 0) {
                        Map<String, Object> aggregation = new HashMap<>();
                        aggregation.put("windowStart", window.getStart());
                        aggregation.put("windowEnd", window.getEnd());
                        aggregation.put("tgid", tgid);
                        aggregation.put("syscall", syscall);
                        aggregation.put("count", count);
                        aggregation.put("timestamp", System.currentTimeMillis());
                        aggregation.put("id", tgid + "_" + window.getStart() + "_" + syscall);
                        
                        out.collect(aggregation);
                    }
                })
                .name("Window Aggregation")
                .sinkTo(
                        new Elasticsearch7SinkBuilder<Map<String, Object>>()
                                .setHosts(elasticsearchHosts.split(","))
                                .setDeliveryGuarantee(DeliveryGuarantee.AT_LEAST_ONCE)
                                .setBulkFlushMaxActions(100)
                                .setBulkFlushInterval(1000L)
                                .setEmitter((aggregation, context, indexer) -> {
                                    try {
                                        String id = (String) aggregation.get("id");
                                        String json = objectMapper.writeValueAsString(aggregation);
                                        
                                        IndexRequest request = Requests.indexRequest()
                                                .index(elasticsearchIndex)
                                                .id(id)
                                                .source(json, org.elasticsearch.common.xcontent.XContentType.JSON);
                                        
                                        indexer.add(request);
                                    } catch (Exception e) {
                                        System.err.println("Failed to create index request: " + e.getMessage());
                                    }
                                })
                                .build()
                )
                .name("Elasticsearch Sink");

        parsedStream
                .map(event -> "Received: tgid=" + event.get("tgid") + ", syscall=" + event.get("syscall"))
                .print();

        env.execute("Reliable Syscall Aggregation Job");
    }
}
