import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

/**
 * Represents a connection to a SQL Server instance.
 * Contains all necessary information to establish and maintain a database connection.
 */
export interface SqlServerConnection {
    /** Unique identifier for the connection */
    id: string;

    /** Server name or address (can include port as server,port) */
    serverName: string;

    /** Optional database name (defaults to 'master') */
    database?: string;

    /** Authentication method to use */
    authentication: 'windows' | 'sql';

    /** SQL Server login username (required for SQL authentication) */
    username?: string;

    /** SQL Server login password (required for SQL authentication) */
    password?: string;
}

/**
 * Service for managing SQL Server connections.
 * Handles connection persistence, retrieval, and modification.
 */
export class ConnectionService {
    private static instance: ConnectionService;
    private connections: SqlServerConnection[];

    private constructor(private context: vscode.ExtensionContext) {
        this.connections = this.loadConnections();
    }

    /**
     * Gets the singleton instance of ConnectionService.
     * Creates the instance if it doesn't exist.
     * 
     * @param context - VSCode extension context (required for first instantiation)
     * @throws Error if context is not provided on first instantiation
     */
    public static getInstance(context?: vscode.ExtensionContext): ConnectionService {
        if (!ConnectionService.instance) {
            if (!context) {
                throw new Error('Context must be provided when creating ConnectionService instance');
            }
            ConnectionService.instance = new ConnectionService(context);
        }
        return ConnectionService.instance;
    }

    /**
     * Loads saved connections from VSCode global state.
     * 
     * @returns Array of saved SQL Server connections
     */
    private loadConnections(): SqlServerConnection[] {
        return this.context.globalState.get<SqlServerConnection[]>('sqlConnections', []);
    }

    /**
     * Saves current connections to VSCode global state.
     */
    private saveConnections(): void {
        this.context.globalState.update('sqlConnections', this.connections);
    }

    /**
     * Retrieves all saved connections.
     * 
     * @returns Copy of the connections array
     */
    public getConnections(): SqlServerConnection[] {
        return [...this.connections];
    }

    /**
     * Retrieves a specific connection by ID.
     * 
     * @param id - Unique identifier of the connection
     * @returns The connection if found, undefined otherwise
     */
    public getConnection(id: string): SqlServerConnection | undefined {
        return this.connections.find(conn => conn.id === id);
    }

    /**
     * Adds a new connection to the saved connections.
     * Automatically generates a unique ID for the connection.
     * 
     * @param connection - Connection details without ID
     * @returns The newly created connection with generated ID
     */
    public addConnection(connection: Omit<SqlServerConnection, 'id'>): SqlServerConnection {
        const newConnection: SqlServerConnection = {
            ...connection,
            id: uuidv4()
        };
        this.connections.push(newConnection);
        this.saveConnections();
        return newConnection;
    }

    /**
     * Removes a connection from saved connections.
     * 
     * @param id - ID of the connection to remove
     */
    public removeConnection(id: string): void {
        this.connections = this.connections.filter(conn => conn.id !== id);
        this.saveConnections();
    }

    /**
     * Updates an existing connection with new properties.
     * 
     * @param id - ID of the connection to update
     * @param connection - Partial connection object with properties to update
     * @returns The updated connection
     * @throws Error if connection with ID is not found
     */
    public updateConnection(id: string, connection: Partial<SqlServerConnection>): SqlServerConnection {
        const index = this.connections.findIndex(conn => conn.id === id);
        if (index === -1) {
            throw new Error(`Connection with id ${id} not found`);
        }

        this.connections[index] = {
            ...this.connections[index],
            ...connection
        };
        this.saveConnections();
        return this.connections[index];
    }
} 