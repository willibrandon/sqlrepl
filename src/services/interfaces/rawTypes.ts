/**
 * Raw publication data as returned from SQL Server sp_helppublication.
 * Maps directly to the result set columns without type transformation.
 * 
 * @remarks
 * The 'replication frequency' property uses spaces in its name to match
 * the SQL Server column name exactly. Use bracket notation to access it.
 */
export interface RawPublication {
    /** Name of the publication */
    name: string;

    /** Description of the publication */
    description: string;

    /** Current status (e.g., "active", "inactive") */
    status: string;

    /** Whether changes are synchronized immediately */
    immediate_sync: boolean;

    /** Whether the publication is enabled for internet access */
    enabled_for_internet: boolean;

    /** Whether push subscriptions are allowed */
    allow_push: boolean;

    /** Whether pull subscriptions are allowed */
    allow_pull: boolean;

    /** Whether anonymous subscriptions are allowed */
    allow_anonymous: boolean;

    /** Whether immediate synchronization is ready */
    immediate_sync_ready: boolean;

    /** Whether transactional synchronization is allowed */
    allow_sync_tran: boolean;

    /** 
     * Replication type indicator (0=Transactional, 1=Snapshot)
     * Note: Property name contains spaces to match SQL Server column
     */
    'replication frequency': number;

    /** Allows for additional properties returned by SQL Server */
    [key: string]: unknown;
}