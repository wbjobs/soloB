package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	clientv3 "go.etcd.io/etcd/client/v3"
	"github.com/google/uuid"
	"github.com/robfig/cron/v3"

	"github.com/example/distributed-cron/pkg/dag"
	"github.com/example/distributed-cron/pkg/job"
	"github.com/example/distributed-cron/pkg/lock"
	"github.com/example/distributed-cron/pkg/store"
)

func main() {
	nodeID := uuid.New().String()
	log.Printf("Starting scheduler with node ID: %s", nodeID)

	defaultTimeZone := getEnv("SCHEDULER_TIMEZONE", "UTC")
	log.Printf("Default scheduler timezone: %s", defaultTimeZone)

	etcdEndpoints := getEnv("ETCD_ENDPOINTS", "localhost:2379")
	endpoints := strings.Split(etcdEndpoints, ",")

	etcdClient, err := clientv3.New(clientv3.Config{
		Endpoints:   endpoints,
		DialTimeout: 5 * time.Second,
	})
	if err != nil {
		log.Fatalf("Failed to connect to etcd: %v", err)
	}
	defer etcdClient.Close()

	lockManager := lock.NewDistributedLockManagerFromClient(etcdClient)
	jobStore := store.NewJobStore(etcdClient)

	jobs := []job.Job{
		{
			Name:           "extract-job",
			CronExpression: "0 */2 * * * *",
			TimeZone:       "Asia/Shanghai",
			Command:        "echo Extracting data",
			MaxRetries:     3,
			InitialDelay:   1 * time.Second,
			BackoffFactor:  2.0,
		},
		{
			Name:           "transform-job",
			CronExpression: "0 */2 * * * *",
			TimeZone:       "Asia/Shanghai",
			Deps:           []string{"extract-job"},
			Command:        "echo Transforming data",
			MaxRetries:     2,
			InitialDelay:   2 * time.Second,
			BackoffFactor:  1.5,
		},
		{
			Name:           "load-job",
			CronExpression: "0 */2 * * * *",
			TimeZone:       "Asia/Shanghai",
			Deps:           []string{"transform-job"},
			Command:        "echo Loading data",
			MaxRetries:     2,
			InitialDelay:   2 * time.Second,
			BackoffFactor:  1.5,
		},
		{
			Name:           "report-job",
			CronExpression: "0 */5 * * * *",
			TimeZone:       "UTC",
			Deps:           []string{"load-job"},
			Command:        "echo Generating report",
			MaxRetries:     1,
			InitialDelay:   5 * time.Second,
			BackoffFactor:  2.0,
		},
	}

	if err := dag.ValidateDAG(jobs); err != nil {
		log.Fatalf("DAG validation failed: %v", err)
	}
	log.Println("DAG validation passed")

	executor := job.NewExecutor(lockManager, jobStore, nodeID)
	depChecker := dag.NewDependencyChecker(jobStore, jobs)

	defaultParser, err := createCronParser(defaultTimeZone)
	if err != nil {
		log.Fatalf("Failed to create default cron parser: %v", err)
	}

	c := cron.New(
		cron.WithParser(defaultParser),
		cron.WithChain(
			cron.SkipIfStillRunning(cron.DefaultLogger),
			cron.Recover(cron.DefaultLogger),
		),
	)

	for _, j := range jobs {
		currentJob := j

		parser := defaultParser
		if currentJob.TimeZone != "" && currentJob.TimeZone != defaultTimeZone {
			jobParser, err := createCronParser(currentJob.TimeZone)
			if err != nil {
				log.Fatalf("Failed to create cron parser for job %s with timezone %s: %v",
					currentJob.Name, currentJob.TimeZone, err)
			}
			parser = jobParser
		}

		schedule, err := parser.Parse(currentJob.CronExpression)
		if err != nil {
			log.Fatalf("Failed to parse cron expression for job %s: %v", currentJob.Name, err)
		}

		jobFunc := func() {
			ctx := context.Background()
			effectiveTZ := getEffectiveTimeZone(currentJob.TimeZone, defaultTimeZone)

			if len(currentJob.Deps) > 0 {
				ok, err := depChecker.CheckDependencies(ctx, currentJob.Name)
				if err != nil {
					log.Printf("Failed to check dependencies for job %s: %v", currentJob.Name, err)
					return
				}
				if !ok {
					unmetDeps, _ := depChecker.GetUnmetDependencies(ctx, currentJob.Name)
					log.Printf("Skipping job %s: unmet dependencies %v (timezone: %s)",
						currentJob.Name, unmetDeps, effectiveTZ)
					return
				}
			}

			log.Printf("Triggering job: %s (timezone: %s, deps: %v)",
				currentJob.Name, effectiveTZ, currentJob.Deps)

			err := executor.Execute(ctx, currentJob)
			if err != nil {
				log.Printf("Job %s failed after retries: %v", currentJob.Name, err)
			} else {
				log.Printf("Job %s completed successfully", currentJob.Name)
			}
		}

		_, err = c.Schedule(schedule, cron.FuncJob(jobFunc))
		if err != nil {
			log.Fatalf("Failed to schedule job %s: %v", currentJob.Name, err)
		}

		effectiveTZ := getEffectiveTimeZone(currentJob.TimeZone, defaultTimeZone)
		log.Printf("Scheduled job %s with cron: %s, timezone: %s, deps: %v",
			currentJob.Name, currentJob.CronExpression, effectiveTZ, currentJob.Deps)
	}

	c.Start()
	log.Println("Scheduler started")

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	<-sigChan
	log.Println("Shutting down scheduler...")

	ctx := c.Stop()
	<-ctx.Done()

	log.Println("Scheduler stopped")
}

func createCronParser(timezone string) (cron.Parser, error) {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return nil, fmt.Errorf("failed to load timezone %s: %w", timezone, err)
	}

	parser := cron.NewParser(
		cron.SecondOptional | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor,
	)

	return cron.WithLocation(loc)(parser), nil
}

func getEffectiveTimeZone(jobTimeZone, defaultTimeZone string) string {
	if jobTimeZone != "" {
		return jobTimeZone
	}
	return defaultTimeZone
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}

func init() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
}
