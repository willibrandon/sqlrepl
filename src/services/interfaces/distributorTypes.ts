/**
 * Information about a SQL Server distributor configuration.
 * Represents the current state of distribution setup on a server.
 */
export interface DistributorInfo {
    /** Whether the server is configured as a distributor */
    isDistributor: boolean;

    /** Whether the server is configured as a publisher */
    isPublisher: boolean;

    /** Name of the distribution database, null if not configured */
    distributionDb: string | null;

    /** Path to the working directory for replication, null if not configured */
    workingDirectory: string | null;

    /** Remote distributor configuration */
    remoteDist: {
        /** Whether distribution is handled by a remote server */
        isRemote: boolean;
        /** Name of the remote distributor server, null if local distribution */
        serverName: string | null;
    };
}