// Base interface for stored procedure parameters
export interface StoredProcParams {
    [key: string]: string | number | boolean | Date | Buffer | null | undefined;
}

// Interface for sp_addsubscription parameters
export interface AddSubscriptionParams extends StoredProcParams {
    publication: string;
    subscriber: string;
    destination_db: string;
    subscription_type: 'push' | 'pull';
    sync_type: 'none' | 'automatic' | 'replication support only';
}

// Interface for sp_addpushsubscription_agent parameters
export interface AddPushSubscriptionParams extends StoredProcParams {
    publication: string;
    subscriber: string;
    subscriber_db: string;
    job_login?: string;
    job_password?: string;
    subscriber_security_mode?: number;
}

// Interface for sp_addpullsubscription_agent parameters
export interface AddPullSubscriptionParams extends StoredProcParams {
    publication: string;
    publisher: string;
    publisher_db: string;
    job_login?: string;
    job_password?: string;
    publisher_security_mode?: number;
}