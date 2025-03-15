import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { SqlService } from './sqlService';

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
    
    /** Operating system of the SQL Server instance (Windows or Linux) */
    serverOs?: 'Windows' | 'Linux';
    
    /** SQL Server version information */
    serverVersion?: string;
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
    private saveConnections(connections: SqlServerConnection[]): void {
        this.context.globalState.update('sqlConnections', connections);
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
     * Also tests the connection and detects OS type.
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
        this.saveConnections(this.connections);
        
        // Test connection and detect OS type
        console.log('Testing connection to detect OS type...');
        const sqlService = SqlService.getInstance();
        sqlService.testConnection(newConnection)
            .then(success => {
                if (success) {
                    console.log(`Successfully detected OS type for ${newConnection.serverName}: ${newConnection.serverOs || 'Unknown'}`);
                } else {
                    console.log(`Failed to detect OS type for ${newConnection.serverName}`);
                }
            })
            .catch(error => {
                console.error(`Error detecting OS type for ${newConnection.serverName}:`, error);
            });
        
        return newConnection;
    }

    /**
     * Removes a connection from saved connections.
     * 
     * @param id - ID of the connection to remove
     */
    public removeConnection(id: string): void {
        this.connections = this.connections.filter(conn => conn.id !== id);
        this.saveConnections(this.connections);
    }

    /**
     * Updates properties of an existing connection
     * @param id The ID of the connection to update
     * @param updates The properties to update
     * @returns True if the connection was updated successfully
     */
    public updateConnection(id: string, updates: Partial<SqlServerConnection>): boolean {
        const connections = this.getConnections();
        const index = connections.findIndex(conn => conn.id === id);
        
        if (index === -1) {
            return false;
        }
        
        // Update the connection with the provided properties
        connections[index] = {
            ...connections[index],
            ...updates
        };
        
        // Save the updated connections
        this.saveConnections(connections);
        return true;
    }
} 