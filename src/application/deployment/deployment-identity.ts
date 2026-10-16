export interface DeploymentIdentity {
  readonly service: "fm-control-center";
  readonly environment: "render" | "unknown";
  readonly gitCommit: string | null;
  readonly gitBranch: string | null;
}

export function readDeploymentIdentity(): DeploymentIdentity {
  return {
    service: "fm-control-center",
    environment: process.env.RENDER === "true" ? "render" : "unknown",
    gitCommit: process.env.RENDER_GIT_COMMIT?.trim() || null,
    gitBranch: process.env.RENDER_GIT_BRANCH?.trim() || null,
  };
}

export function deploymentEnvironmentLabel(
  identity: DeploymentIdentity,
): string {
  if (identity.environment !== "render") return "Ambiente não identificado";
  return identity.gitBranch
    ? "Render · " + identity.gitBranch
    : "Render";
}
