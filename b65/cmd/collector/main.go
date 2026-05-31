package main

import (
	"distributed-tracing/collector"
	"flag"
	"log"
)

func main() {
	port := flag.Int("port", 8080, "Collector port")
	sampleRate := flag.Float64("sample-rate", 0.1, "Sampling rate (0.0 to 1.0)")
	esURL := flag.String("es", "", "Elasticsearch URL (optional)")
	useFile := flag.Bool("file", false, "Write to local file")
	filePath := flag.String("file-path", "traces.json", "Local file path")
	flag.Parse()

	config := collector.Config{
		Port:          *port,
		Elasticsearch: *esURL,
		LocalFile:     *filePath,
		UseES:         *esURL != "",
		UseFile:       *useFile,
		Sampler:       collector.NewProbabilisticSampler(*sampleRate),
	}

	c := collector.NewCollector(config)

	if err := c.Start(); err != nil {
		log.Fatalf("Collector error: %v", err)
	}
}
