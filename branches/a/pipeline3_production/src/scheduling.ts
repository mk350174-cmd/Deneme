// P3.08-DIST Distributed Render — Resource Scheduling & Worker Assignment
// NOT phase P3.09 (Automated QA, qa.ts) — see the naming note in orchestration_p309.ts.
// Manages worker capacity discovery, shard-to-worker assignment, and
// resource quota enforcement. Supports local (CPU/GPU) + Kaggle workers.

import type { ShardAssignment, ShardSpecification, WorkerCapabilityProfile, WorkerType } from "./types.js";

// Kaggle kernel capability profiles (based on current Kaggle offerings)
// These are OBSERVED baselines and can be updated based on empirical testing
const KAGGLE_WORKER_PROFILES: Record<string, WorkerCapabilityProfile> = {
  kaggle_cpu_2core: {
    worker_type: "kaggle_cpu_2core",
    estimated_fps: 2, // slower CPU, conservative estimate
    memory_gb: 8,
    session_timeout_hours: 9, // typical Kaggle session limit
    cost_per_hour_units: 50, // Kaggle CPU cost
    available: false, // will be probed at runtime
  },
  kaggle_cpu_4core: {
    worker_type: "kaggle_cpu_4core",
    estimated_fps: 4, // faster CPU
    memory_gb: 16,
    session_timeout_hours: 9,
    cost_per_hour_units: 100,
    available: false,
  },
  kaggle_gpu_t4: {
    worker_type: "kaggle_gpu_t4",
    estimated_fps: 15, // GPU acceleration
    memory_gb: 16,
    session_timeout_hours: 12, // GPU sessions may have longer timeout
    cost_per_hour_units: 500,
    available: false,
  },
};

// Local worker profiles (detected at runtime)
const LOCAL_WORKER_PROFILES: Record<string, WorkerCapabilityProfile> = {
  local_cpu: {
    worker_type: "local_cpu",
    estimated_fps: 3, // variable, conservatively low
    memory_gb: 32, // assume substantial local RAM
    session_timeout_hours: 24, // no session timeout locally
    cost_per_hour_units: 0, // local render is "free" (no Kaggle cost)
    available: false, // will be probed
  },
  local_gpu: {
    worker_type: "local_gpu",
    estimated_fps: 12, // GPU-accelerated local render
    memory_gb: 32,
    session_timeout_hours: 24,
    cost_per_hour_units: 0,
    available: false,
  },
};

export interface AvailableCapacity {
  local_cpu: boolean;
  local_gpu: boolean;
  kaggle_available_notebooks: number;
  safe_concurrent_notebooks: number;
  available_workers: WorkerCapabilityProfile[];
}

export interface SchedulerConfig {
  enableLocal: boolean; // allow local rendering
  enableKaggle: boolean; // allow Kaggle notebook rendering
  safetyMargin: number; // 0.75 = use 75% of discovered capacity (conservative default)
  maxRetriesPerShard: number; // default 2
}

export class ResourceScheduler {
  private config: SchedulerConfig;
  private workerProfiles: Map<WorkerType, WorkerCapabilityProfile>;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = {
      enableLocal: true,
      enableKaggle: true,
      safetyMargin: 0.75,
      maxRetriesPerShard: 2,
      ...config,
    };

    this.workerProfiles = new Map();
    Object.values({ ...LOCAL_WORKER_PROFILES, ...KAGGLE_WORKER_PROFILES }).forEach((profile) => {
      this.workerProfiles.set(profile.worker_type, profile);
    });
  }

  // Probe available resources at runtime. This should be called at the start
  // of P3.08-DIST orchestration to determine what workers are actually available.
  async probeAvailableCapacity(): Promise<AvailableCapacity> {
    const available_workers: WorkerCapabilityProfile[] = [];
    const capacity: AvailableCapacity = {
      local_cpu: false,
      local_gpu: false,
      kaggle_available_notebooks: 0,
      safe_concurrent_notebooks: 0,
      available_workers,
    };

    // Check local CPU availability (always assume available if enabled)
    if (this.config.enableLocal) {
      const localCpuProfile = this.workerProfiles.get("local_cpu");
      if (localCpuProfile) {
        localCpuProfile.available = true;
        available_workers.push(localCpuProfile);
        capacity.local_cpu = true;
      }
    }

    // Check local GPU availability (would need actual GPU detection in production)
    // For now, assume false (GPU must be explicitly enabled + confirmed)
    // In real implementation: check nvidia-smi or similar
    // if (this.config.enableLocal && hasNvidiaGpu()) { ... }

    // Probe Kaggle capacity (this would call kaggle API in production)
    // For now: conservative estimate (5-10 concurrent notebooks per account)
    if (this.config.enableKaggle) {
      // PLACEHOLDER: actual Kaggle API query would go here
      // const kaggleCapacity = await queryKaggleApi();
      // For now, use a reasonable default
      capacity.kaggle_available_notebooks = 5; // conservative estimate
      capacity.safe_concurrent_notebooks = Math.floor(capacity.kaggle_available_notebooks * this.config.safetyMargin);

      // Add Kaggle worker profiles (if any notebooks available)
      if (capacity.kaggle_available_notebooks > 0) {
        const cpuProfile = this.workerProfiles.get("kaggle_cpu_4core");
        if (cpuProfile) {
          cpuProfile.available = true;
          available_workers.push(cpuProfile);
        }
      }
    }

    return capacity;
  }

  // Assign shards to workers based on available capacity and cost constraints
  assignShards(shards: ShardSpecification[], capacity: AvailableCapacity, costLedger: { wouldExceedLimit: (provider: string, cost: number) => boolean }): ShardAssignment[] {
    const assignments: ShardAssignment[] = [];

    // Sort shards by estimated frame count (largest first) for even load distribution
    const sortedShards = [...shards].sort((a, b) => b.estimated_frames - a.estimated_frames);

    // Assign shards round-robin to available workers
    let workerIndex = 0;
    for (let i = 0; i < sortedShards.length; i++) {
      const shard = sortedShards[i]!; // i < sortedShards.length, just checked

      // Select next worker (round-robin)
      const nextWorker = capacity.available_workers[workerIndex % capacity.available_workers.length];
      if (!nextWorker) {
        throw new Error("No available workers for shard assignment");
      }

      // Estimate render time
      const estimatedDurationS = shard.estimated_frames / nextWorker.estimated_fps;

      // Estimate cost (only for Kaggle workers)
      const costEstimate = nextWorker.worker_type.startsWith("kaggle") ? (estimatedDurationS / 3600) * nextWorker.cost_per_hour_units : 0;

      // Check cost limit (hard stop if would exceed)
      if (costEstimate > 0 && costLedger.wouldExceedLimit("kaggle_render", costEstimate)) {
        throw new Error(`Shard ${shard.shard_id} would exceed cost limit: ${costEstimate} units`);
      }

      assignments.push({
        shard_id: shard.shard_id,
        assigned_worker: nextWorker.worker_type,
        estimated_duration_s: estimatedDurationS,
        cost_estimate_units: costEstimate,
        priority: i, // lower priority index = higher priority
        retry_count: 0,
      });

      workerIndex++;
    }

    return assignments;
  }

  // Estimate total render time given assignments
  estimateTotalRenderTimeS(assignments: ShardAssignment[], maxConcurrency: number): number {
    if (assignments.length === 0) return 0;

    // Group assignments by worker
    const assignmentsByWorker = new Map<string, ShardAssignment[]>();
    for (const assignment of assignments) {
      const workerKey = assignment.assigned_worker;
      if (!assignmentsByWorker.has(workerKey)) {
        assignmentsByWorker.set(workerKey, []);
      }
      assignmentsByWorker.get(workerKey)!.push(assignment);
    }

    // Calculate per-worker time (sequential within worker, parallel across workers)
    let maxWorkerTimeS = 0;
    for (const workerAssignments of assignmentsByWorker.values()) {
      const workerTotalS = workerAssignments.reduce((sum, a) => sum + a.estimated_duration_s, 0);
      maxWorkerTimeS = Math.max(maxWorkerTimeS, workerTotalS);
    }

    return maxWorkerTimeS;
  }

  // Estimate total cost given assignments
  estimateTotalCostUnits(assignments: ShardAssignment[]): number {
    return assignments.reduce((sum, a) => sum + a.cost_estimate_units, 0);
  }
}
