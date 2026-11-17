import { execFileSync } from "node:child_process";
import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface EnvironmentManifest {
  capturedAt: string;
  sourceCommit: string;
  node: string;
  platform: string;
  arch: string;
  osRelease: string;
  cpu: {
    model: string;
    logicalProcessors: number;
  };
  memory: {
    totalBytes: number;
  };
  disk: {
    path: string;
    totalBytes: number;
    freeBytes: number;
    filesystem: string | null;
    driveType: string | null;
  };
  docker: {
    version: string | null;
    composeVersion: string | null;
    server: {
      version: string | null;
      operatingSystem: string | null;
      logicalProcessors: number | null;
      memoryBytes: number | null;
      rootDir: string | null;
      storageDriver: string | null;
    };
    resourceLimits: DockerContainerLimit[];
    containerBudget: ContainerBudgetManifest | null;
  };
  api: {
    baseUrl: string;
    readinessStatus: string | null;
  };
  baseline: {
    approvedCpuCount: 8;
    approvedMemoryBytes: 17_179_869_184;
    approvedDiskBytes: 100_000_000_000;
    cpuMatches: boolean;
    memoryMatches: boolean;
    diskTotalAtLeastApproved: boolean;
    containerBudgetMatches: boolean;
    certificationEligible: boolean;
  };
}

export interface DockerContainerLimit {
  name: string;
  service: string | null;
  nanoCpus: number | null;
  memoryBytes: number | null;
}

export interface ContainerBudgetManifest {
  project: string;
  expectedServices: string[];
  observedServices: string[];
  cpuCores: number;
  memoryBytes: number;
  complete: boolean;
  constrained: boolean;
  withinApprovedCpu: boolean;
  withinApprovedMemory: boolean;
  matchesApprovedBudget: boolean;
}

export const CAPACITY_COMPOSE_SERVICES = ["api", "minio", "postgres", "redis", "worker"] as const;

export async function collectEnvironmentManifest(input: {
  apiBaseUrl: string;
  sourceCommit?: string;
  repositoryPath?: string;
  composeProject?: string;
}): Promise<EnvironmentManifest> {
  const dockerInfo = dockerServerInfo();
  const cpu = os.cpus()[0]?.model ?? "unknown";
  const diskPath = path.resolve(input.repositoryPath ?? process.cwd());
  const disk = await diskStats(diskPath);
  const diskMetadata = windowsDiskMetadata(diskPath);
  const readinessStatus = await readReadiness(input.apiBaseUrl);
  const logicalProcessors = os.cpus().length;
  const memoryBytes = os.totalmem();
  const dockerCpuCount = dockerInfo?.NCPU ?? null;
  const dockerMemoryBytes = dockerInfo?.MemTotal ?? null;
  const cpuMatches = (dockerCpuCount ?? logicalProcessors) === 8;
  const memoryMatches = (dockerMemoryBytes ?? memoryBytes) === 17_179_869_184;
  const diskTotalAtLeastApproved = disk.totalBytes >= 100_000_000_000;
  const resourceLimits = dockerResourceLimits(input.composeProject);
  const containerBudget = input.composeProject
    ? summarizeContainerBudget(input.composeProject, resourceLimits)
    : null;
  return {
    capturedAt: new Date().toISOString(),
    sourceCommit: input.sourceCommit ?? resolveSourceCommit(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpu: {
      model: cpu,
      logicalProcessors,
    },
    memory: {
      totalBytes: memoryBytes,
    },
    disk: {
      ...disk,
      ...diskMetadata,
    },
    docker: {
      version: commandVersion("docker", ["--version"]),
      composeVersion: commandVersion("docker", ["compose", "version"]),
      server: {
        version: dockerInfo?.ServerVersion ?? null,
        operatingSystem: dockerInfo?.OperatingSystem ?? null,
        logicalProcessors: dockerCpuCount,
        memoryBytes: dockerMemoryBytes,
        rootDir: dockerInfo?.DockerRootDir ?? null,
        storageDriver: dockerInfo?.Driver ?? null,
      },
      resourceLimits,
      containerBudget,
    },
    api: {
      baseUrl: input.apiBaseUrl,
      readinessStatus,
    },
    baseline: {
      approvedCpuCount: 8,
      approvedMemoryBytes: 17_179_869_184,
      approvedDiskBytes: 100_000_000_000,
      cpuMatches,
      memoryMatches,
      diskTotalAtLeastApproved,
      containerBudgetMatches: containerBudget?.matchesApprovedBudget ?? false,
      certificationEligible: isCertificationEligible({
        cpuMatches,
        memoryMatches,
        diskTotalAtLeastApproved,
        containerBudgetMatches: containerBudget?.matchesApprovedBudget ?? false,
      }),
    },
  };
}

interface DockerInfo {
  NCPU?: number;
  MemTotal?: number;
  ServerVersion?: string;
  OperatingSystem?: string;
  DockerRootDir?: string;
  Driver?: string;
}

function dockerServerInfo(): DockerInfo | null {
  try {
    const output = execFileSync("docker", ["info", "--format", "{{json .}}"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    return JSON.parse(output) as DockerInfo;
  } catch {
    return null;
  }
}

async function diskStats(target: string): Promise<{
  path: string;
  totalBytes: number;
  freeBytes: number;
}> {
  const stats = await statfs(target);
  return {
    path: target,
    totalBytes: Number(stats.blocks) * Number(stats.bsize),
    freeBytes: Number(stats.bavail) * Number(stats.bsize),
  };
}

function windowsDiskMetadata(target: string): {
  filesystem: string | null;
  driveType: string | null;
} {
  if (process.platform !== "win32") {
    return { filesystem: null, driveType: null };
  }
  const driveLetter = /^([A-Za-z]):/.exec(path.resolve(target))?.[1];
  if (!driveLetter) {
    return { filesystem: null, driveType: null };
  }
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${driveLetter}:'" | Select-Object FileSystem,DriveType | ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    const metadata = JSON.parse(output) as { FileSystem?: string; DriveType?: number };
    return {
      filesystem: metadata.FileSystem ?? null,
      driveType: metadata.DriveType === undefined ? null : String(metadata.DriveType),
    };
  } catch {
    return { filesystem: null, driveType: null };
  }
}

function dockerResourceLimits(composeProject?: string): DockerContainerLimit[] {
  try {
    const arguments_ = composeProject
      ? ["ps", "-q", "--filter", `label=com.docker.compose.project=${composeProject}`]
      : ["ps", "-q"];
    const ids = execFileSync("docker", arguments_, {
      encoding: "utf8",
      timeout: 10_000,
    })
      .split(/\s+/u)
      .filter(Boolean);
    if (ids.length === 0) {
      return [];
    }
    const inspected = JSON.parse(
      execFileSync("docker", ["inspect", ...ids], {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      }),
    ) as Array<{
      Name?: string;
      Config?: {
        Labels?: Record<string, string>;
      };
      HostConfig?: { NanoCpus?: number; Memory?: number };
    }>;
    return inspected.map((container) => ({
      name: container.Name?.replace(/^\//u, "") ?? "unknown",
      service: container.Config?.Labels?.["com.docker.compose.service"] ?? null,
      nanoCpus: container.HostConfig?.NanoCpus ?? null,
      memoryBytes: container.HostConfig?.Memory ?? null,
    }));
  } catch {
    return [];
  }
}

export function summarizeContainerBudget(
  project: string,
  limits: readonly DockerContainerLimit[],
): ContainerBudgetManifest {
  const selected = limits.filter((limit) => limit.service !== null);
  const observedServices = [...new Set(selected.map((limit) => limit.service!))].sort();
  const expectedServices = [...CAPACITY_COMPOSE_SERVICES];
  const complete = expectedServices.every((service) => observedServices.includes(service));
  const constrained = selected.every(
    (limit) =>
      limit.service === null || ((limit.nanoCpus ?? 0) > 0 && (limit.memoryBytes ?? 0) > 0),
  );
  const cpuCores = selected.reduce((total, limit) => total + (limit.nanoCpus ?? 0) / 1e9, 0);
  const memoryBytes = selected.reduce((total, limit) => total + (limit.memoryBytes ?? 0), 0);
  const withinApprovedCpu = cpuCores === 8;
  const withinApprovedMemory = memoryBytes === 17_179_869_184;
  return {
    project,
    expectedServices,
    observedServices,
    cpuCores,
    memoryBytes,
    complete,
    constrained,
    withinApprovedCpu,
    withinApprovedMemory,
    matchesApprovedBudget: complete && constrained && withinApprovedCpu && withinApprovedMemory,
  };
}

export function isCertificationEligible(input: {
  cpuMatches: boolean;
  memoryMatches: boolean;
  diskTotalAtLeastApproved: boolean;
  containerBudgetMatches: boolean;
}): boolean {
  return (
    input.cpuMatches &&
    input.memoryMatches &&
    input.diskTotalAtLeastApproved &&
    input.containerBudgetMatches
  );
}

async function readReadiness(apiBaseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(new URL("/api/v1/health/ready", apiBaseUrl), {
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json()) as { data?: { status?: string } };
    return body.data?.status ?? `http-${response.status}`;
  } catch {
    return null;
  }
}

function commandVersion(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 10_000 }).trim();
  } catch {
    return null;
  }
}

function resolveSourceCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
  } catch {
    return "unknown";
  }
}
