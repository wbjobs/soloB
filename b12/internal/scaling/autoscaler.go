package scaling

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"dtsplatform/internal/config"
	"dtsplatform/internal/models"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

type AutoScaler struct {
	cfg             *config.Config
	kubeClient      *kubernetes.Clientset
	metricsClient   *metricsclient.Clientset
	policy          *models.ScalingPolicy
	currentReplicas int
	lastScaleUp     time.Time
	lastScaleDown   time.Time
	mu              sync.RWMutex
	actions         []models.ScalingAction
	running         bool
	stopCh          chan struct{}
}

func NewAutoScaler(cfg *config.Config) (*AutoScaler, error) {
	var kubeClient *kubernetes.Clientset
	var metricsClient *metricsclient.Clientset

	if cfg.AutoScaling.Enabled {
		config, err := rest.InClusterConfig()
		if err != nil {
			log.Printf("Warning: Not running in Kubernetes cluster, auto-scaling disabled")
		} else {
			kubeClient, err = kubernetes.NewForConfig(config)
			if err != nil {
				return nil, fmt.Errorf("failed to create kubernetes client: %w", err)
			}
			metricsClient, err = metricsclient.NewForConfig(config)
			if err != nil {
				return nil, fmt.Errorf("failed to create metrics client: %w", err)
			}
		}
	}

	return &AutoScaler{
		cfg:           cfg,
		kubeClient:    kubeClient,
		metricsClient: metricsClient,
		policy:        &cfg.AutoScaling.Policy,
		actions:       make([]models.ScalingAction, 0, 100),
		stopCh:        make(chan struct{}),
	}, nil
}

func (a *AutoScaler) Start(ctx context.Context) {
	if !a.cfg.AutoScaling.Enabled {
		log.Println("Auto-scaling disabled")
		return
	}

	a.running = true
	log.Println("Auto-scaler started")

	go a.scalerLoop(ctx)
}

func (a *AutoScaler) Stop() {
	a.running = false
	close(a.stopCh)
	log.Println("Auto-scaler stopped")
}

func (a *AutoScaler) scalerLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(a.cfg.AutoScaling.ScaleIntervalSeconds) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-a.stopCh:
			return
		case <-ticker.C:
			if err := a.checkAndScale(ctx); err != nil {
				log.Printf("Auto-scaling error: %v", err)
			}
		}
	}
}

func (a *AutoScaler) checkAndScale(ctx context.Context) error {
	metrics, err := a.collectMetrics(ctx)
	if err != nil {
		return fmt.Errorf("failed to collect metrics: %w", err)
	}

	a.mu.RLock()
	scaleUpCooldown := a.policy.ScaleUpCooldownMinutes
	scaleDownCooldown := a.policy.ScaleDownCooldownMinutes
	now := time.Now()
	canScaleUp := now.Sub(a.lastScaleUp) > time.Duration(scaleUpCooldown)*time.Minute
	canScaleDown := now.Sub(a.lastScaleDown) > time.Duration(scaleDownCooldown)*time.Minute
	currentReplicas := a.currentReplicas
	a.mu.RUnlock()

	if currentReplicas < a.policy.MinExecutors {
		currentReplicas = a.policy.MinExecutors
	}

	targetReplicas := currentReplicas

	if shouldScaleUp(metrics, a.policy) && canScaleUp {
		targetReplicas = currentReplicas + 1
		if targetReplicas > a.policy.MaxExecutors {
			targetReplicas = a.policy.MaxExecutors
		}
		if targetReplicas != currentReplicas {
			return a.scale(ctx, targetReplicas, "scale_up", metrics)
		}
	} else if shouldScaleDown(metrics, a.policy) && canScaleDown {
		targetReplicas = currentReplicas - 1
		if targetReplicas < a.policy.MinExecutors {
			targetReplicas = a.policy.MinExecutors
		}
		if targetReplicas != currentReplicas {
			return a.scale(ctx, targetReplicas, "scale_down", metrics)
		}
	}

	return nil
}

func (a *AutoScaler) collectMetrics(ctx context.Context) (*models.ScalingMetrics, error) {
	metrics := &models.ScalingMetrics{
		Timestamp: time.Now(),
	}

	if a.kubeClient == nil {
		return metrics, nil
	}

	deployment, err := a.kubeClient.AppsV1().Deployments(a.cfg.AutoScaling.KubernetesNamespace).Get(
		ctx, a.cfg.AutoScaling.ExecutorDeploymentName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get deployment: %w", err)
	}

	if deployment.Spec.Replicas != nil {
		metrics.ExecutorCount = int(*deployment.Spec.Replicas)
		a.mu.Lock()
		a.currentReplicas = metrics.ExecutorCount
		a.mu.Unlock()
	}

	if a.metricsClient != nil {
		podMetrics, err := a.metricsClient.MetricsV1beta1().PodMetricses(a.cfg.AutoScaling.KubernetesNamespace).List(
			ctx, metav1.ListOptions{
				LabelSelector: fmt.Sprintf("app=%s", a.cfg.AutoScaling.ExecutorLabel),
			})
		if err != nil {
			log.Printf("Warning: Failed to get pod metrics: %v", err)
		} else {
			var totalCPU, totalMemory float64
			var maxCPU, maxMemory float64
			count := 0

			for _, podMetric := range podMetrics.Items {
				for _, container := range podMetric.Containers {
					cpuMilli := container.Usage.Cpu().MilliValue()
					memBytes := container.Usage.Memory().Value()
					memGB := float64(memBytes) / (1024 * 1024 * 1024)

					totalCPU += float64(cpuMilli)
					totalMemory += memGB
					if float64(cpuMilli) > maxCPU {
						maxCPU = float64(cpuMilli)
					}
					if memGB > maxMemory {
						maxMemory = memGB
					}
					count++
				}
			}

			if count > 0 {
				metrics.AverageCPUUsage = totalCPU / float64(count)
				metrics.AverageMemoryUsage = totalMemory / float64(count)
				metrics.MaxCPUUsage = maxCPU
				metrics.MaxMemoryUsage = maxMemory
			}
		}
	}

	return metrics, nil
}

func (a *AutoScaler) scale(ctx context.Context, targetReplicas int, actionType string, metrics *models.ScalingMetrics) error {
	if a.kubeClient == nil {
		log.Printf("Auto-scale action: %s to %d replicas (simulation mode)", actionType, targetReplicas)
		return nil
	}

	if a.policy.UseHPA {
		return a.scaleViaHPA(ctx, targetReplicas)
	}

	return a.scaleDirectly(ctx, targetReplicas, actionType, metrics)
}

func (a *AutoScaler) scaleDirectly(ctx context.Context, targetReplicas int, actionType string, metrics *models.ScalingMetrics) error {
	a.mu.RLock()
	fromCount := a.currentReplicas
	a.mu.RUnlock()

	action := &models.ScalingAction{
		ActionType:      actionType,
		Timestamp:       time.Now(),
		FromCount:       fromCount,
		ToCount:         targetReplicas,
		MetricsSnapshot: metrics,
		Success:         false,
	}

	replicas := int32(targetReplicas)
	_, err := a.kubeClient.AppsV1().Deployments(a.cfg.AutoScaling.KubernetesNamespace).UpdateScale(
		ctx,
		a.cfg.AutoScaling.ExecutorDeploymentName,
		&appsv1.Scale{
			ObjectMeta: metav1.ObjectMeta{
				Name:      a.cfg.AutoScaling.ExecutorDeploymentName,
				Namespace: a.cfg.AutoScaling.KubernetesNamespace,
			},
			Spec: appsv1.ScaleSpec{
				Replicas: replicas,
			},
		},
		metav1.UpdateOptions{},
	)

	if err != nil {
		action.ErrorMessage = err.Error()
		a.mu.Lock()
		a.actions = append(a.actions, *action)
		a.mu.Unlock()
		return fmt.Errorf("failed to scale: %w", err)
	}

	action.Success = true

	a.mu.Lock()
	a.currentReplicas = targetReplicas
	if actionType == "scale_up" {
		a.lastScaleUp = time.Now()
	} else {
		a.lastScaleDown = time.Now()
	}
	a.actions = append(a.actions, *action)
	a.mu.Unlock()

	log.Printf("Auto-scaled successfully: %s from %d to %d replicas", actionType, fromCount, targetReplicas)
	return nil
}

func (a *AutoScaler) scaleViaHPA(ctx context.Context, targetReplicas int) error {
	hpa, err := a.kubeClient.AutoscalingV2().HorizontalPodAutoscalers(a.cfg.AutoScaling.KubernetesNamespace).Get(
		ctx, a.cfg.AutoScaling.HPAName, metav1.GetOptions{})
	if err != nil {
		return a.createHPA(ctx, targetReplicas)
	}

	hpa.Spec.MaxReplicas = int32(a.policy.MaxExecutors)
	if hpa.Spec.MinReplicas == nil || *hpa.Spec.MinReplicas != int32(a.policy.MinExecutors) {
		minReplicas := int32(a.policy.MinExecutors)
		hpa.Spec.MinReplicas = &minReplicas
	}

	_, err = a.kubeClient.AutoscalingV2().HorizontalPodAutoscalers(a.cfg.AutoScaling.KubernetesNamespace).Update(
		ctx, hpa, metav1.UpdateOptions{})
	return err
}

func (a *AutoScaler) createHPA(ctx context.Context, targetReplicas int) error {
	minReplicas := int32(a.policy.MinExecutors)
	cpuPercent := int32(a.policy.CPUThresholdHigh * 100)
	memPercent := int32(a.policy.MemoryThresholdHigh * 100)

	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      a.cfg.AutoScaling.HPAName,
			Namespace: a.cfg.AutoScaling.KubernetesNamespace,
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       a.cfg.AutoScaling.ExecutorDeploymentName,
			},
			MinReplicas: &minReplicas,
			MaxReplicas: int32(a.policy.MaxExecutors),
			Metrics: []autoscalingv2.MetricSpec{
				{
					Type: autoscalingv2.ResourceMetricSourceType,
					Resource: &autoscalingv2.ResourceMetricSource{
						Name: corev1.ResourceCPU,
						Target: autoscalingv2.MetricTarget{
							Type:               autoscalingv2.UtilizationMetricType,
							AverageUtilization: &cpuPercent,
						},
					},
				},
				{
					Type: autoscalingv2.ResourceMetricSourceType,
					Resource: &autoscalingv2.ResourceMetricSource{
						Name: corev1.ResourceMemory,
						Target: autoscalingv2.MetricTarget{
							Type:               autoscalingv2.UtilizationMetricType,
							AverageUtilization: &memPercent,
						},
					},
				},
			},
		},
	}

	_, err := a.kubeClient.AutoscalingV2().HorizontalPodAutoscalers(a.cfg.AutoScaling.KubernetesNamespace).Create(
		ctx, hpa, metav1.CreateOptions{})
	return err
}

func (a *AutoScaler) GetScalingActions(limit int) []models.ScalingAction {
	a.mu.RLock()
	defer a.mu.RUnlock()

	if limit <= 0 || limit > len(a.actions) {
		limit = len(a.actions)
	}
	actions := make([]models.ScalingAction, limit)
	for i := 0; i < limit; i++ {
		actions[i] = a.actions[len(a.actions)-1-i]
	}
	return actions
}

func (a *AutoScaler) UpdateQueueMetrics(pending, running int) {
	a.mu.Lock()
	defer a.mu.Unlock()
}

func shouldScaleUp(metrics *models.ScalingMetrics, policy *models.ScalingPolicy) bool {
	if metrics.ExecutorCount >= policy.MaxExecutors {
		return false
	}

	if metrics.QueueLength > policy.QueueThresholdHigh {
		return true
	}

	if metrics.AverageCPUUsage > policy.CPUThresholdHigh*1000 {
		return true
	}

	if metrics.AverageMemoryUsage > policy.MemoryThresholdHigh {
		return true
	}

	return false
}

func shouldScaleDown(metrics *models.ScalingMetrics, policy *models.ScalingPolicy) bool {
	if metrics.ExecutorCount <= policy.MinExecutors {
		return false
	}

	if metrics.QueueLength > 0 {
		return false
	}

	if metrics.RunningTasks > 0 {
		return false
	}

	if metrics.AverageCPUUsage < policy.CPUThresholdLow*1000 &&
		metrics.AverageMemoryUsage < policy.MemoryThresholdLow &&
		metrics.QueueLength < policy.QueueThresholdLow {
		return true
	}

	return false
}
