/**
 * Base interface for SQL Server stored procedure parameters.
 * Provides type-safe parameter passing while allowing for any valid SQL parameter type.
 */
export interface StoredProcParams {
    /** 
     * Dynamic key-value pairs for stored procedure parameters.
     * Values must be SQL Server compatible types.
     */
    [key: string]: string | number | boolean | Date | Buffer | null | undefined;
}

/**
 * Parameters for sp_addsubscription stored procedure.
 * Used to create a new subscription to a publication.
 */
export interface AddSubscriptionParams extends StoredProcParams {
    /** Name of the publication to subscribe to */
    publication: string;

    /** Name of the subscribing server */
    subscriber: string;

    /** Name of the destination database */
    destination_db: string;

    /** Type of subscription (push or pull) */
    subscription_type: 'push' | 'pull';

    /** How the subscription should be synchronized */
    sync_type: 'none' | 'automatic' | 'replication support only';
}

/**
 * Parameters for sp_addpushsubscription_agent stored procedure.
 * Configures the agent for a push subscription.
 */
export interface AddPushSubscriptionParams extends StoredProcParams {
    /** Name of the publication */
    publication: string;

    /** Name of the subscribing server */
    subscriber: string;

    /** Name of the subscriber database */
    subscriber_db: string;

    /** Optional login name for the agent job */
    job_login?: string;

    /** Optional password for the agent job */
    job_password?: string;

    /** Security mode for the subscriber (0=SQL Login, 1=Windows Auth) */
    subscriber_security_mode?: number;
}

/**
 * Parameters for sp_addpullsubscription_agent stored procedure.
 * Configures the agent for a pull subscription.
 */
export interface AddPullSubscriptionParams extends StoredProcParams {
    /** Name of the publication */
    publication: string;

    /** Name of the publishing server */
    publisher: string;

    /** Name of the publisher database */
    publisher_db: string;

    /** Optional login name for the agent job */
    job_login?: string;

    /** Optional password for the agent job */
    job_password?: string;

    /** Security mode for the publisher (0=SQL Login, 1=Windows Auth) */
    publisher_security_mode?: number;
}