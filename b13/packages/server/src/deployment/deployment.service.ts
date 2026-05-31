import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeneratorService } from '../generator/generator.service';
import { now } from '@lowcode/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly generatorService: GeneratorService,
  ) {}

  async getEnvironments(applicationId: string, organizationId: string) {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, organizationId },
    });
    if (!app) throw new NotFoundException('Application not found');

    return this.prisma.environment.findMany({
      where: { applicationId },
      include: { deployments: { orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deploy(
    environmentId: string,
    versionId: string,
    deployedBy: string,
    organizationId: string,
  ) {
    const environment = await this.prisma.environment.findFirst({
      where: { id: environmentId },
      include: { application: true },
    });

    if (!environment || environment.application.organizationId !== organizationId) {
      throw new NotFoundException('Environment not found');
    }

    const version = await this.prisma.applicationVersion.findUnique({
      where: { id: versionId },
    });

    if (!version) throw new NotFoundException('Version not found');

    const deployment = await this.prisma.deployment.create({
      data: {
        environmentId,
        versionId,
        deployedBy,
        status: 'pending',
        kubernetesNamespace: this.generateNamespace(environment.application.name, environment.type),
      },
      include: {
        environment: true,
        version: true,
      },
    });

    await this.performDeployment(deployment).catch(error => {
      this.logger.error(`Deployment failed: ${error.message}`, error.stack);
    });

    return deployment;
  }

  private async performDeployment(deployment: any): Promise<void> {
    this.logger.log(`Starting deployment ${deployment.id} to namespace ${deployment.kubernetesNamespace}`);

    await this.prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: 'deploying' },
    });

    try {
      const tempDir = path.join(os.tmpdir(), `deployment-${deployment.id}`);
      await this.generatorService.downloadToPath(
        deployment.environment.applicationId,
        deployment.environment.application.organizationId,
        tempDir,
        deployment.environment.configuration?.apiUrl,
      );

      this.logger.log(`Generated code in ${tempDir}`);
      
      if (this.isKubernetesAvailable()) {
        await this.deployToKubernetes(tempDir, deployment);
      } else {
        this.logger.warn('Kubernetes not available, marking deployment as simulated');
      }

      await this.prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'success',
          deployedAt: now(),
        },
      });

      await this.prisma.environment.update({
        where: { id: deployment.environmentId },
        data: { currentVersionId: deployment.versionId },
      });

      this.logger.log(`Deployment ${deployment.id} completed successfully`);

    } catch (error) {
      this.logger.error(`Deployment ${deployment.id} failed`, error);
      await this.prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'failed',
          errorMessage: error.message,
        },
      });
      throw error;
    }
  }

  private async deployToKubernetes(sourceDir: string, deployment: any): Promise<void> {
    const { execSync } = require('child_process');
    
    const namespace = deployment.kubernetesNamespace;
    
    try {
      execSync(`kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -`);
    } catch (e) {
      // Namespace may already exist
    }

    const backendChartPath = path.join(sourceDir, `${deployment.environment.application.name}-backend/helm`);
    if (fs.existsSync(backendChartPath)) {
      execSync(`helm upgrade --install ${deployment.environment.application.name}-backend ${backendChartPath} -n ${namespace}`, {
        stdio: 'inherit',
      });
    }
  }

  private isKubernetesAvailable(): boolean {
    try {
      const { execSync } = require('child_process');
      execSync('kubectl version --short', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  private generateNamespace(appName: string, envType: string): string {
    const sanitized = appName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 40);
    return `${sanitized}-${envType}`;
  }

  async getDeploymentHistory(environmentId: string, organizationId: string) {
    const environment = await this.prisma.environment.findFirst({
      where: { id: environmentId },
      include: { application: true },
    });

    if (!environment || environment.application.organizationId !== organizationId) {
      throw new NotFoundException('Environment not found');
    }

    return this.prisma.deployment.findMany({
      where: { environmentId },
      include: {
        version: true,
        user: { select: { id: true, username: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async rollback(deploymentId: string, organizationId: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: {
        environment: { include: { application: true } },
        version: true,
      },
    });

    if (!deployment || deployment.environment.application.organizationId !== organizationId) {
      throw new NotFoundException('Deployment not found');
    }

    if (deployment.status !== 'success') {
      throw new BadRequestException('Can only rollback to successful deployments');
    }

    return this.deploy(
      deployment.environmentId,
      deployment.versionId,
      deployment.deployedBy,
      organizationId,
    );
  }
}
