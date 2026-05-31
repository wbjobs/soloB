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
import org.elasticsearch.action.index.IndexRequest;
import org.elasticsearch.client.Requests;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

public class SyscallDetailSinkJob {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        final StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        
        env.enableCheckpointing(60000);
        
        String kafkaBrokers = System.getenv().getOrDefault("KAFKA_BROKERS", "localhost:9092");
        String kafkaTopic = System.getenv().getOrDefault("KAFKA_DETAIL_TOPIC", "syscalls-detail");
        String kafkaGroupId = System.getenv().getOrDefault("KAFKA_GROUP_ID", "syscall-detail-consumer");
        String elasticsearchHosts = System.getenv().getOrDefault("ES_HOSTS", "http://localhost:9200");
        String elasticsearchIndex = System.getenv().getOrDefault("ES_DETAIL_INDEX", "syscalls-detail");

        System.out.println("===============================================");
        System.out.println("  Syscall Detail Sink Job Starting");
        System.out.println("===============================================");
        System.out.println("Kafka Brokers: " + kafkaBrokers);
        System.out.println("Kafka Detail Topic: " + kafkaTopic);
        System.out.println("Elasticsearch: " + elasticsearchHosts);
        System.out.println("Elasticsearch Detail Index: " + elasticsearchIndex);
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
                WatermarkStrategy.forBoundedOutOfOrderness(Duration.ofSeconds(30)),
                "Kafka Detail Source"
        );

        SingleOutputStreamOperator<Map<String, Object>> parsedStream = kafkaStream
                .map(new MapFunction<String, Map<String, Object>>() {
                    @Override
                    public Map<String, Object> map(String json) {
                        try {
                            JsonNode node = objectMapper.readTree(json);
                            
                            Map<String, Object> result = new HashMap<>();
                            
                            if (node.has("id")) {
                                result.put("id", node.get("id").asText());
                            }
                            
                            result.put("pid", getLong(node, "pid", 0L));
                            result.put("tgid", getLong(node, "tgid", 0L));
                            result.put("syscall", getText(node, "syscall", "unknown"));
                            result.put("syscall_id", getLong(node, "syscall_id", 0L));
                            result.put("timestamp_ns", getLong(node, "timestamp_ns", 0L));
                            result.put("timestamp_ms", getLong(node, "timestamp_ms", 0L));
                            result.put("timestamp_iso", getText(node, "timestamp_iso", ""));
                            result.put("arg1", getText(node, "arg1", ""));
                            result.put("arg2", getText(node, "arg2", ""));
                            result.put("arg3", getText(node, "arg3", ""));
                            result.put("ret", getLong(node, "ret", 0L));
                            result.put("success", getBoolean(node, "success", true));
                            result.put("duration_ns", getLong(node, "duration_ns", 0L));
                            result.put("cpu", getLong(node, "cpu", 0L));
                            
                            return result;
                        } catch (Exception e) {
                            System.err.println("Failed to parse detail JSON: " + json);
                            return null;
                        }
                    }
                    
                    private long getLong(JsonNode node, String field, long defaultValue) {
                        return node.has(field) ? node.get(field).asLong() : defaultValue;
                    }
                    
                    private String getText(JsonNode node, String field, String defaultValue) {
                        return node.has(field) ? node.get(field).asText() : defaultValue;
                    }
                    
                    private boolean getBoolean(JsonNode node, String field, boolean defaultValue) {
                        return node.has(field) ? node.get(field).asBoolean() : defaultValue;
                    }
                })
                .filter(event -> event != null)
                .name("Parse Detail Events");

        parsedStream
                .sinkTo(
                        new Elasticsearch7SinkBuilder<Map<String, Object>>()
                                .setHosts(elasticsearchHosts.split(","))
                                .setDeliveryGuarantee(DeliveryGuarantee.AT_LEAST_ONCE)
                                .setBulkFlushMaxActions(500)
                                .setBulkFlushInterval(500L)
                                .setBulkFlushMaxSizeMb(5)
                                .setEmitter((event, context, indexer) -> {
                                    try {
                                        String id = (String) event.getOrDefault("id", 
                                            event.get("tgid") + "_" + event.get("timestamp_ns") + "_" + event.get("syscall"));
                                        String json = objectMapper.writeValueAsString(event);
                                        
                                        IndexRequest request = Requests.indexRequest()
                                                .index(elasticsearchIndex)
                                                .id(id)
                                                .source(json, org.elasticsearch.common.xcontent.XContentType.JSON);
                                        
                                        indexer.add(request);
                                    } catch (Exception e) {
                                        System.err.println("Failed to create detail index request: " + e.getMessage());
                                    }
                                })
                                .build()
                )
                .name("Elasticsearch Detail Sink");

        parsedStream
                .map(event -> "Detail: tgid=" + event.get("tgid") + 
                              ", syscall=" + event.get("syscall") + 
                              ", ret=" + event.get("ret"))
                .print();

        env.execute("Syscall Detail Sink Job");
    }
}
